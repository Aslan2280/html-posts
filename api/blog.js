import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Путь к файлу базы данных
const DB_PATH = path.join('/tmp', 'blog-db.json');

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Хэширование пароля
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Генерация токена
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Генерация ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Чтение тела запроса
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ========== РАБОТА С БАЗОЙ ДАННЫХ ==========

// Инициализация базы данных
async function initDB() {
  try {
    await fs.access(DB_PATH);
    console.log('База данных существует');
  } catch {
    console.log('Создаем новую базу данных');
    const initialData = {
      users: [
        {
          id: 'admin',
          username: 'admin',
          passwordHash: hashPassword('admin123'),
          role: 'admin',
          quanta: 1000,
          createdAt: new Date().toISOString()
        },
        {
          id: 'user1',
          username: 'user',
          passwordHash: hashPassword('user123'),
          role: 'user',
          quanta: 100,
          createdAt: new Date().toISOString()
        }
      ],
      posts: [
        {
          id: 'post1',
          content: 'Добро пожаловать в блог!',
          authorId: 'admin',
          authorName: 'admin',
          createdAt: new Date().toISOString()
        },
        {
          id: 'post2',
          content: 'Здесь можно писать посты и зарабатывать кванты!',
          authorId: 'user1',
          authorName: 'user',
          createdAt: new Date().toISOString()
        }
      ],
      sessions: [],
      transactions: [],
      settings: {
        quantaPerPost: 5,
        version: '2.0'
      }
    };
    
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
    console.log('База данных создана');
  }
}

// Чтение базы данных
async function readDB() {
  await initDB();
  const data = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(data);
}

// Запись в базу данных
async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Валидация токена
async function validateToken(token) {
  try {
    const db = await readDB();
    const session = db.sessions?.find(s => s.token === token);
    
    if (!session) {
      console.log('Сессия не найдена');
      return null;
    }
    
    // Проверяем срок действия (30 дней для админов, 1 день для пользователей)
    const tokenAge = Date.now() - new Date(session.createdAt).getTime();
    const maxAge = session.role === 'admin' ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    
    if (tokenAge > maxAge) {
      console.log('Токен просрочен');
      // Удаляем просроченную сессию
      db.sessions = db.sessions.filter(s => s.token !== token);
      await writeDB(db);
      return null;
    }
    
    const user = db.users.find(u => u.id === session.userId);
    if (!user) {
      console.log('Пользователь не найден');
      return null;
    }
    
    return {
      id: user.id,
      username: user.username,
      role: user.role || 'user',
      quanta: user.quanta || 0,
      token: session.token
    };
  } catch (error) {
    console.error('Ошибка валидации токена:', error);
    return null;
  }
}

// Добавить транзакцию квантов
async function addTransaction(userId, amount, reason, adminId = null) {
  const db = await readDB();
  const user = db.users.find(u => u.id === userId);
  
  if (!user) {
    throw new Error('Пользователь не найден');
  }
  
  // Обновляем баланс пользователя
  user.quanta = (user.quanta || 0) + amount;
  
  // Создаем запись о транзакции
  const transaction = {
    id: generateId(),
    userId,
    amount,
    reason,
    adminId,
    timestamp: new Date().toISOString()
  };
  
  if (!db.transactions) db.transactions = [];
  db.transactions.unshift(transaction);
  
  await writeDB(db);
  return user.quanta;
}

// ========== ОСНОВНОЙ ОБРАБОТЧИК ==========

export default async function handler(req, res) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  // Настраиваем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Обрабатываем preflight запросы
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Разбираем URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    
    // ========== PUBLIC ROUTES ==========
    
    // Регистрация
    if (pathname === '/api/blog/register' && req.method === 'POST') {
      console.log('Регистрация нового пользователя');
      
      const body = await readBody(req);
      let data;
      
      try {
        data = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ 
          success: false,
          error: 'Неверный формат данных' 
        });
      }
      
      const { username, password } = data;
      
      if (!username || !password) {
        return res.status(400).json({ 
          success: false,
          error: 'Заполните все поля' 
        });
      }
      
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ 
          success: false,
          error: 'Имя пользователя должно быть от 3 до 20 символов' 
        });
      }
      
      if (password.length < 4) {
        return res.status(400).json({ 
          success: false,
          error: 'Пароль должен быть минимум 4 символа' 
        });
      }
      
      const db = await readDB();
      
      // Проверяем, существует ли пользователь
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ 
          success: false,
          error: 'Пользователь с таким именем уже существует' 
        });
      }
      
      // Создаем нового пользователя
      const newUser = {
        id: generateId(),
        username,
        passwordHash: hashPassword(password),
        role: 'user',
        quanta: 50, // Начальный бонус
        createdAt: new Date().toISOString()
      };
      
      db.users.push(newUser);
      
      // Записываем начальную транзакцию
      await addTransaction(newUser.id, 50, 'Начальный бонус');
      
      return res.status(201).json({ 
        success: true,
        message: 'Регистрация успешна' 
      });
    }
    
    // Вход
    if (pathname === '/api/blog/login' && req.method === 'POST') {
      console.log('Попытка входа');
      
      const body = await readBody(req);
      let data;
      
      try {
        data = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ 
          success: false,
          error: 'Неверный формат данных' 
        });
      }
      
      const { username, password } = data;
      
      if (!username || !password) {
        return res.status(400).json({ 
          success: false,
          error: 'Заполните все поля' 
        });
      }
      
      const db = await readDB();
      const user = db.users.find(u => 
        u.username.toLowerCase() === username.toLowerCase() && 
        u.passwordHash === hashPassword(password)
      );
      
      if (!user) {
        return res.status(401).json({ 
          success: false,
          error: 'Неверное имя пользователя или пароль' 
        });
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
      
      // Возвращаем данные пользователя
      const userData = {
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt
      };
      
      console.log('Успешный вход пользователя:', user.username);
      
      return res.status(200).json({
        success: true,
        token,
        user: userData,
        message: 'Вход выполнен успешно'
      });
    }
    
    // ========== PROTECTED ROUTES ==========
    
    // Проверяем авторизацию для защищенных маршрутов
    const authHeader = req.headers.authorization;
    let currentUser = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      currentUser = await validateToken(token);
    }
    
    // Получить все посты
    if (pathname === '/api/blog' && req.method === 'GET') {
      console.log('Получение всех постов');
      
      const db = await readDB();
      
      // Сортируем посты по дате (новые сверху)
      const sortedPosts = db.posts.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      // Форматируем ответ
      const posts = sortedPosts.map(post => ({
        id: post.id,
        content: post.content,
        authorId: currentUser ? post.authorId : undefined,
        authorName: currentUser ? post.authorName : 'Пользователь',
        createdAt: post.createdAt,
        canDelete: currentUser ? (currentUser.id === post.authorId || currentUser.role === 'admin') : false
      }));
      
      return res.status(200).json({
        success: true,
        posts
      });
    }
    
    // Создать пост
    if (pathname === '/api/blog' && req.method === 'POST') {
      console.log('Создание нового поста');
      
      if (!currentUser) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется авторизация' 
        });
      }
      
      const body = await readBody(req);
      let data;
      
      try {
        data = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ 
          success: false,
          error: 'Неверный формат данных' 
        });
      }
      
      const { content } = data;
      
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ 
          success: false,
          error: 'Текст поста обязателен' 
        });
      }
      
      if (content.trim().length === 0) {
        return res.status(400).json({ 
          success: false,
          error: 'Текст поста не может быть пустым' 
        });
      }
      
      if (content.length > 10000) {
        return res.status(400).json({ 
          success: false,
          error: 'Пост слишком длинный (максимум 10000 символов)' 
        });
      }
      
      const db = await readDB();
      
      // Создаем новый пост
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
      const newBalance = await addTransaction(
        currentUser.id, 
        quantaEarned, 
        'Награда за пост'
      );
      
      // Ограничиваем количество постов
      if (db.posts.length > 1000) {
        db.posts = db.posts.slice(0, 1000);
      }
      
      await writeDB(db);
      
      console.log('Пост создан, начислено квантов:', quantaEarned);
      
      return res.status(201).json({
        success: true,
        post: newPost,
        quantaEarned,
        newBalance,
        message: 'Пост успешно создан'
      });
    }
    
    // Удалить пост
    if (pathname === '/api/blog' && req.method === 'DELETE') {
      console.log('Удаление поста');
      
      if (!currentUser) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется авторизация' 
        });
      }
      
      const id = url.searchParams.get('id');
      
      if (!id) {
        return res.status(400).json({ 
          success: false,
          error: 'ID поста обязателен' 
        });
      }
      
      const db = await readDB();
      const post = db.posts.find(p => p.id === id);
      
      if (!post) {
        return res.status(404).json({ 
          success: false,
          error: 'Пост не найден' 
        });
      }
      
      // Проверяем права доступа
      if (post.authorId !== currentUser.id && currentUser.role !== 'admin') {
        return res.status(403).json({ 
          success: false,
          error: 'Недостаточно прав для удаления этого поста' 
        });
      }
      
      // Удаляем пост
      db.posts = db.posts.filter(p => p.id !== id);
      await writeDB(db);
      
      const deletedByAdmin = currentUser.role === 'admin' && post.authorId !== currentUser.id;
      
      console.log('Пост удален, удален админом:', deletedByAdmin);
      
      return res.status(200).json({ 
        success: true,
        message: 'Пост успешно удален',
        deletedByAdmin
      });
    }
    
    // Получить информацию о себе
    if (pathname === '/api/blog/me' && req.method === 'GET') {
      console.log('Получение информации о пользователе');
      
      if (!currentUser) {
        return res.status(401).json({ 
          success: false,
          error: 'Требуется авторизация' 
        });
      }
      
      const db = await readDB();
      const user = db.users.find(u => u.id === currentUser.id);
      
      if (!user) {
        return res.status(404).json({ 
          success: false,
          error: 'Пользователь не найден' 
        });
      }
      
      const userData = {
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt,
        postCount: db.posts.filter(p => p.authorId === user.id).length
      };
      
      // Получаем последние транзакции
      const recentTransactions = db.transactions
        ?.filter(t => t.userId === user.id)
        ?.slice(0, 10) || [];
      
      return res.status(200).json({
        success: true,
        user: userData,
        recentTransactions
      });
    }
    
    // ========== ADMIN ROUTES ==========
    
    // Получить статистику (админ)
    if (pathname === '/api/blog/admin/stats' && req.method === 'GET') {
      console.log('Получение статистики (админ)');
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ 
          success: false,
          error: 'Требуются права администратора' 
        });
      }
      
      const db = await readDB();
      
      const stats = {
        totalUsers: db.users.length,
        totalPosts: db.posts.length,
        totalQuanta: db.users.reduce((sum, u) => sum + (u.quanta || 0), 0),
        settings: db.settings,
        recentTransactions: db.transactions?.slice(0, 10) || []
      };
      
      return res.status(200).json({
        success: true,
        stats
      });
    }
    
    // Получить всех пользователей (админ)
    if (pathname === '/api/blog/admin/users' && req.method === 'GET') {
      console.log('Получение списка пользователей (админ)');
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ 
          success: false,
          error: 'Требуются права администратора' 
        });
      }
      
      const db = await readDB();
      
      const users = db.users.map(user => ({
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt,
        postCount: db.posts.filter(p => p.authorId === user.id).length
      }));
      
      return res.status(200).json({
        success: true,
        users
      });
    }
    
    // Добавить кванты пользователю (админ)
    if (pathname === '/api/blog/admin/add-quanta' && req.method === 'POST') {
      console.log('Добавление квантов (админ)');
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ 
          success: false,
          error: 'Требуются права администратора' 
        });
      }
      
      const body = await readBody(req);
      let data;
      
      try {
        data = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ 
          success: false,
          error: 'Неверный формат данных' 
        });
      }
      
      const { userId, amount, reason } = data;
      
      if (!userId || !amount || !reason) {
        return res.status(400).json({ 
          success: false,
          error: 'Заполните все поля' 
        });
      }
      
      if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ 
          success: false,
          error: 'Некорректная сумма' 
        });
      }
      
      try {
        const newBalance = await addTransaction(
          userId, 
          amount, 
          reason, 
          currentUser.id
        );
        
        console.log(`Админ ${currentUser.username} добавил ${amount} квантов пользователю ${userId}`);
        
        return res.status(200).json({
          success: true,
          message: `Добавлено ${amount} квантов`,
          newBalance
        });
      } catch (error) {
        return res.status(404).json({ 
          success: false,
          error: error.message 
        });
      }
    }
    
    // Получить информацию о пользователе (админ)
    if (pathname.startsWith('/api/blog/admin/user/') && req.method === 'GET') {
      console.log('Получение информации о пользователе (админ)');
      
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ 
          success: false,
          error: 'Требуются права администратора' 
        });
      }
      
      const userId = pathname.split('/').pop();
      const db = await readDB();
      const user = db.users.find(u => u.id === userId);
      
      if (!user) {
        return res.status(404).json({ 
          success: false,
          error: 'Пользователь не найден' 
        });
      }
      
      const userData = {
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt,
        posts: db.posts.filter(p => p.authorId === userId).slice(0, 10),
        transactions: db.transactions?.filter(t => t.userId === userId).slice(0, 10) || []
      };
      
      return res.status(200).json({
        success: true,
        user: userData
      });
    }
    
    // Если маршрут не найден
    return res.status(404).json({
      success: false,
      error: 'Маршрут не найден',
      availableRoutes: [
        'POST /api/blog/register',
        'POST /api/blog/login',
        'GET /api/blog (auth)',
        'POST /api/blog (auth)',
        'DELETE /api/blog?id= (auth)',
        'GET /api/blog/me (auth)',
        'GET /api/blog/admin/stats (admin)',
        'GET /api/blog/admin/users (admin)',
        'POST /api/blog/admin/add-quanta (admin)',
        'GET /api/blog/admin/user/:id (admin)'
      ]
    });
    
  } catch (error) {
    console.error('Критическая ошибка сервера:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
