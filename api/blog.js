import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Путь к файлу базы данных
const DB_PATH = path.join('/tmp', 'blog-db-auth.json');

// Инициализация базы данных
async function initDB() {
  try {
    await fs.access(DB_PATH);
  } catch {
    // Создаем начальные данные
    const initialData = {
      users: [
        {
          id: '1',
          username: 'admin',
          // Пароль: admin123 (в продакшене хранить хэши!)
          passwordHash: hashPassword('admin123'),
          createdAt: new Date().toISOString()
        },
        {
          id: '2',
          username: 'user',
          // Пароль: user123
          passwordHash: hashPassword('user123'),
          createdAt: new Date().toISOString()
        }
      ],
      posts: [
        {
          id: '1',
          content: 'Добро пожаловать в блог с авторизацией!\nЗдесь только авторизованные пользователи могут публиковать посты.',
          authorId: '1',
          authorName: 'admin',
          createdAt: new Date().toISOString()
        },
        {
          id: '2',
          content: 'Это демонстрационный пост\nВы можете удалять только свои посты',
          authorId: '2',
          authorName: 'user',
          createdAt: new Date().toISOString()
        }
      ],
      sessions: [],
      settings: {
        maxPosts: 1000,
        version: '1.1'
      }
    };
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

// Хэширование пароля (упрощенное для демо)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Генерация токена
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Чтение данных
async function readDB() {
  await initDB();
  const data = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(data);
}

// Запись данных
async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Генерация ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Валидация токена
async function validateToken(token) {
  const db = await readDB();
  const session = db.sessions.find(s => s.token === token);
  
  if (!session) return null;
  
  // Проверяем срок действия (24 часа)
  const tokenAge = Date.now() - new Date(session.createdAt).getTime();
  if (tokenAge > 24 * 60 * 60 * 1000) {
    // Удаляем просроченную сессию
    db.sessions = db.sessions.filter(s => s.token !== token);
    await writeDB(db);
    return null;
  }
  
  const user = db.users.find(u => u.id === session.userId);
  if (!user) return null;
  
  return {
    id: user.id,
    username: user.username,
    token: session.token
  };
}

// Основной обработчик
export default async function handler(req, res) {
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Обработка preflight запросов
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // РЕГИСТРАЦИЯ
    if (req.url === '/api/blog/register' && req.method === 'POST') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        return res.status(400).json({ 
          error: 'Имя пользователя и пароль обязательны' 
        });
      }
      
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ 
          error: 'Имя пользователя должно быть от 3 до 20 символов' 
        });
      }
      
      if (password.length < 4) {
        return res.status(400).json({ 
          error: 'Пароль должен быть минимум 4 символа' 
        });
      }
      
      const db = await readDB();
      
      // Проверяем, существует ли пользователь
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ 
          error: 'Пользователь с таким именем уже существует' 
        });
      }
      
      // Создаем нового пользователя
      const newUser = {
        id: generateId(),
        username,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };
      
      db.users.push(newUser);
      await writeDB(db);
      
      return res.status(201).json({ 
        message: 'Регистрация успешна' 
      });
    }
    
    // ВХОД
    if (req.url === '/api/blog/login' && req.method === 'POST') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        return res.status(400).json({ 
          error: 'Имя пользователя и пароль обязательны' 
        });
      }
      
      const db = await readDB();
      const user = db.users.find(u => 
        u.username.toLowerCase() === username.toLowerCase() && 
        u.passwordHash === hashPassword(password)
      );
      
      if (!user) {
        return res.status(401).json({ 
          error: 'Неверное имя пользователя или пароль' 
        });
      }
      
      // Создаем сессию
      const token = generateToken();
      const session = {
        token,
        userId: user.id,
        createdAt: new Date().toISOString()
      };
      
      db.sessions.push(session);
      await writeDB(db);
      
      // Возвращаем данные пользователя (без пароля)
      const userData = {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt
      };
      
      return res.status(200).json({
        token,
        user: userData,
        message: 'Вход выполнен успешно'
      });
    }
    
    // Остальные маршруты
    const db = await readDB();
    
    // Проверяем авторизацию для защищенных маршрутов
    const authHeader = req.headers.authorization;
    let currentUser = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      currentUser = await validateToken(token);
    }
    
    // GET - Получить все посты
    if (req.method === 'GET' && req.url === '/api/blog') {
      // Сортируем по дате (новые сначала)
      const sortedPosts = db.posts.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      // Для авторизованных пользователей показываем больше информации
      const postsForResponse = sortedPosts.map(post => ({
        ...post,
        // Показываем авторство только если пользователь авторизован
        authorName: currentUser ? post.authorName : undefined,
        authorId: currentUser ? post.authorId : undefined
      }));
      
      return res.status(200).json(postsForResponse);
    }
    
    // POST - Создать новый пост (только для авторизованных)
    if (req.method === 'POST' && req.url === '/api/blog') {
      if (!currentUser) {
        return res.status(401).json({ 
          error: 'Требуется авторизация для создания постов' 
        });
      }
      
      const body = await readBody(req);
      const { content } = JSON.parse(body);

      // Валидация
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ 
          error: 'Текст поста обязателен' 
        });
      }

      if (content.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Текст поста не может быть пустым' 
        });
      }

      if (content.length > 10000) {
        return res.status(400).json({ 
          error: 'Пост слишком длинный (максимум 10000 символов)' 
        });
      }

      // Создаем новый пост
      const newPost = {
        id: generateId(),
        content: content.trim(),
        authorId: currentUser.id,
        authorName: currentUser.username,
        createdAt: new Date().toISOString()
      };

      // Добавляем в начало массива
      db.posts.unshift(newPost);
      
      // Ограничиваем количество постов
      if (db.posts.length > db.settings.maxPosts) {
        db.posts = db.posts.slice(0, db.settings.maxPosts);
      }

      await writeDB(db);

      return res.status(201).json(newPost);
    }
    
    // DELETE - Удалить пост (только автор или админ)
    if (req.method === 'DELETE' && req.url.startsWith('/api/blog')) {
      if (!currentUser) {
        return res.status(401).json({ 
          error: 'Требуется авторизация для удаления постов' 
        });
      }
      
      const urlParams = new URL(req.url, `http://${req.headers.host}`);
      const id = urlParams.searchParams.get('id');
      
      if (!id) {
        return res.status(400).json({ 
          error: 'ID поста обязателен' 
        });
      }

      const post = db.posts.find(p => p.id === id);
      
      if (!post) {
        return res.status(404).json({ 
          error: 'Пост не найден' 
        });
      }
      
      // Проверяем права доступа
      if (post.authorId !== currentUser.id) {
        return res.status(403).json({ 
          error: 'Вы можете удалять только свои посты' 
        });
      }

      // Удаляем пост
      db.posts = db.posts.filter(p => p.id !== id);
      await writeDB(db);

      return res.status(200).json({ 
        message: 'Пост успешно удален' 
      });
    }

    // Метод не поддерживается
    return res.status(405).json({ 
      error: 'Метод не поддерживается' 
    });

  } catch (error) {
    console.error('Ошибка сервера:', error);
    
    return res.status(500).json({ 
      error: 'Внутренняя ошибка сервера',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Вспомогательная функция для чтения тела запроса
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
