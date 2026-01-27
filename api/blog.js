import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DB_PATH = path.join('/tmp', 'blog-db-admin.json');

// Инициализация базы данных
async function initDB() {
  try {
    await fs.access(DB_PATH);
  } catch {
    const initialData = {
      users: [
        {
          id: 'admin1',
          username: 'admin',
          passwordHash: hashPassword('admin123'),
          role: 'admin', // Роль админа
          quanta: 1000, // Начальные кванты у админа
          createdAt: new Date().toISOString()
        }
      ],
      posts: [],
      quantaTransactions: [], // История транзакций квантов
      settings: {
        quantaPerPost: 5, // Квантов за пост
        version: '2.0'
      }
    };
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function readDB() {
  await initDB();
  const data = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Валидация токена
async function validateToken(token) {
  const db = await readDB();
  const session = db.sessions?.find(s => s.token === token);
  
  if (!session) return null;
  
  // Проверяем срок действия (30 дней для админов)
  const tokenAge = Date.now() - new Date(session.createdAt).getTime();
  const maxAge = session.role === 'admin' ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  
  if (tokenAge > maxAge) {
    if (db.sessions) {
      db.sessions = db.sessions.filter(s => s.token !== token);
      await writeDB(db);
    }
    return null;
  }
  
  const user = db.users.find(u => u.id === session.userId);
  if (!user) return null;
  
  return {
    id: user.id,
    username: user.username,
    role: user.role || 'user',
    quanta: user.quanta || 0,
    token: session.token
  };
}

// Добавить кванты пользователю
async function addQuanta(userId, amount, reason, adminId = null) {
  const db = await readDB();
  const user = db.users.find(u => u.id === userId);
  
  if (!user) throw new Error('Пользователь не найден');
  
  user.quanta = (user.quanta || 0) + amount;
  
  // Записываем транзакцию
  const transaction = {
    id: generateId(),
    userId,
    amount,
    reason,
    adminId,
    timestamp: new Date().toISOString()
  };
  
  if (!db.quantaTransactions) db.quantaTransactions = [];
  db.quantaTransactions.unshift(transaction);
  
  await writeDB(db);
  return user.quanta;
}

// Основной обработчик
export default async function handler(req, res) {
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  
  try {
    // РЕГИСТРАЦИЯ
    if (pathname === '/api/blog/register' && req.method === 'POST') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
      }
      
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Имя пользователя 3-20 символов' });
      }
      
      if (password.length < 4) {
        return res.status(400).json({ error: 'Пароль минимум 4 символа' });
      }
      
      const db = await readDB();
      
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
      }
      
      const newUser = {
        id: generateId(),
        username,
        passwordHash: hashPassword(password),
        role: 'user',
        quanta: 50, // Начальные кванты для новых пользователей
        createdAt: new Date().toISOString()
      };
      
      db.users.push(newUser);
      
      // Записываем начальный бонус
      const transaction = {
        id: generateId(),
        userId: newUser.id,
        amount: 50,
        reason: 'Начальный бонус',
        timestamp: new Date().toISOString()
      };
      
      if (!db.quantaTransactions) db.quantaTransactions = [];
      db.quantaTransactions.unshift(transaction);
      
      await writeDB(db);
      
      return res.status(201).json({ message: 'Регистрация успешна' });
    }
    
    // ВХОД
    if (pathname === '/api/blog/login' && req.method === 'POST') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
      }
      
      const db = await readDB();
      const user = db.users.find(u => 
        u.username.toLowerCase() === username.toLowerCase() && 
        u.passwordHash === hashPassword(password)
      );
      
      if (!user) {
        return res.status(401).json({ error: 'Неверные данные' });
      }
      
      // Создаем сессию
      const token = generateToken();
      const session = {
        token,
        userId: user.id,
        role: user.role,
        createdAt: new Date().toISOString()
      };
      
      if (!db.sessions) db.sessions = [];
      db.sessions.push(session);
      await writeDB(db);
      
      const userData = {
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt
      };
      
      return res.status(200).json({
        token,
        user: userData,
        message: 'Вход выполнен'
      });
    }
    
    // ПОЛУЧИТЬ СТАТИСТИКУ (только админ)
    if (pathname === '/api/blog/admin/stats' && req.method === 'GET') {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const token = authHeader.substring(7);
      const user = await validateToken(token);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Требуются права администратора' });
      }
      
      const db = await readDB();
      
      const stats = {
        totalUsers: db.users.length,
        totalPosts: db.posts.length,
        totalQuanta: db.users.reduce((sum, u) => sum + (u.quanta || 0), 0),
        recentTransactions: db.quantaTransactions?.slice(0, 20) || [],
        settings: db.settings
      };
      
      return res.status(200).json(stats);
    }
    
    // ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (только админ)
    if (pathname === '/api/blog/admin/users' && req.method === 'GET') {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const token = authHeader.substring(7);
      const user = await validateToken(token);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Требуются права администратора' });
      }
      
      const db = await readDB();
      
      // Не возвращаем пароли
      const users = db.users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        quanta: u.quanta || 0,
        createdAt: u.createdAt,
        postCount: db.posts.filter(p => p.authorId === u.id).length
      }));
      
      return res.status(200).json(users);
    }
    
    // ДОБАВИТЬ КВАНТЫ (только админ)
    if (pathname === '/api/blog/admin/add-quanta' && req.method === 'POST') {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const token = authHeader.substring(7);
      const admin = await validateToken(token);
      
      if (!admin || admin.role !== 'admin') {
        return res.status(403).json({ error: 'Требуются права администратора' });
      }
      
      const body = await readBody(req);
      const { userId, amount, reason } = JSON.parse(body);
      
      if (!userId || !amount || !reason) {
        return res.status(400).json({ error: 'Заполните все поля' });
      }
      
      if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'Некорректная сумма' });
      }
      
      try {
        const newBalance = await addQuanta(userId, amount, reason, admin.id);
        
        return res.status(200).json({
          message: `Добавлено ${amount} квантов`,
          newBalance
        });
      } catch (error) {
        return res.status(404).json({ error: error.message });
      }
    }
    
    // ПОЛУЧИТЬ ПОЛЬЗОВАТЕЛЯ ПО ID (для админки)
    if (pathname.startsWith('/api/blog/admin/user/') && req.method === 'GET') {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const token = authHeader.substring(7);
      const user = await validateToken(token);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Требуются права администратора' });
      }
      
      const userId = pathname.split('/').pop();
      const db = await readDB();
      const targetUser = db.users.find(u => u.id === userId);
      
      if (!targetUser) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      const userData = {
        id: targetUser.id,
        username: targetUser.username,
        role: targetUser.role,
        quanta: targetUser.quanta || 0,
        createdAt: targetUser.createdAt,
        posts: db.posts.filter(p => p.authorId === userId),
        transactions: db.quantaTransactions?.filter(t => t.userId === userId) || []
      };
      
      return res.status(200).json(userData);
    }
    
    // ОСНОВНОЙ API
    
    const authHeader = req.headers.authorization;
    let currentUser = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      currentUser = await validateToken(token);
    }
    
    const db = await readDB();
    
    // GET - Получить все посты
    if (req.method === 'GET' && pathname === '/api/blog') {
      const sortedPosts = db.posts.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      const postsForResponse = sortedPosts.map(post => ({
        ...post,
        canDelete: currentUser ? (currentUser.id === post.authorId || currentUser.role === 'admin') : false,
        authorName: currentUser ? post.authorName : undefined
      }));
      
      return res.status(200).json(postsForResponse);
    }
    
    // POST - Создать пост
    if (req.method === 'POST' && pathname === '/api/blog') {
      if (!currentUser) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const body = await readBody(req);
      const { content } = JSON.parse(body);
      
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Текст обязателен' });
      }
      
      if (content.trim().length === 0) {
        return res.status(400).json({ error: 'Текст не может быть пустым' });
      }
      
      if (content.length > 10000) {
        return res.status(400).json({ error: 'Максимум 10000 символов' });
      }
      
      const newPost = {
        id: generateId(),
        content: content.trim(),
        authorId: currentUser.id,
        authorName: currentUser.username,
        createdAt: new Date().toISOString()
      };
      
      db.posts.unshift(newPost);
      
      // Начисляем кванты за пост
      const quantaEarned = db.settings.quantaPerPost || 5;
      await addQuanta(currentUser.id, quantaEarned, 'Награда за пост');
      
      if (db.posts.length > 1000) {
        db.posts = db.posts.slice(0, 1000);
      }
      
      await writeDB(db);
      
      return res.status(201).json({
        ...newPost,
        quantaEarned,
        newBalance: currentUser.quanta + quantaEarned
      });
    }
    
    // DELETE - Удалить пост
    if (req.method === 'DELETE' && pathname === '/api/blog') {
      if (!currentUser) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const id = url.searchParams.get('id');
      
      if (!id) {
        return res.status(400).json({ error: 'ID обязателен' });
      }
      
      const post = db.posts.find(p => p.id === id);
      
      if (!post) {
        return res.status(404).json({ error: 'Пост не найден' });
      }
      
      // Проверяем права: либо автор, либо админ
      if (post.authorId !== currentUser.id && currentUser.role !== 'admin') {
        return res.status(403).json({ error: 'Недостаточно прав' });
      }
      
      db.posts = db.posts.filter(p => p.id !== id);
      await writeDB(db);
      
      return res.status(200).json({ 
        message: 'Пост удален',
        deletedByAdmin: currentUser.role === 'admin' && post.authorId !== currentUser.id
      });
    }
    
    // GET - Получить информацию о себе
    if (req.method === 'GET' && pathname === '/api/blog/me') {
      if (!currentUser) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      
      const db = await readDB();
      const user = db.users.find(u => u.id === currentUser.id);
      
      if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      const userData = {
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt,
        postCount: db.posts.filter(p => p.authorId === user.id).length,
        recentTransactions: db.quantaTransactions
          ?.filter(t => t.userId === user.id)
          ?.slice(0, 10) || []
      };
      
      return res.status(200).json(userData);
    }
    
    return res.status(404).json({ error: 'Маршрут не найден' });
    
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).json({ 
      error: 'Ошибка сервера',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
