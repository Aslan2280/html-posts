import fs from 'fs/promises';
import path from 'path';

// Путь к файлу базы данных (используем /tmp для Vercel)
const DB_PATH = path.join('/tmp', 'blog-db.json');

// Инициализация базы данных
async function initDB() {
  try {
    await fs.access(DB_PATH);
  } catch {
    // Создаем начальные данные
    const initialData = {
      posts: [
        {
          id: '1',
          content: 'Добро пожаловать в простой блог!\nЗдесь можно писать что угодно без регистрации.',
          createdAt: new Date().toISOString()
        },
        {
          id: '2',
          content: 'Этот блог работает на Vercel\nFrontend: HTML/CSS/JS\nBackend: Node.js Serverless Functions',
          createdAt: new Date().toISOString()
        }
      ],
      settings: {
        maxPosts: 1000,
        version: '1.0'
      }
    };
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
  }
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

// Основной обработчик
export default async function handler(req, res) {
  // CORS заголовки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Обработка preflight запросов
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const db = await readDB();

    // GET - Получить все посты
    if (req.method === 'GET') {
      // Сортируем по дате (новые сначала)
      const sortedPosts = db.posts.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      return res.status(200).json(sortedPosts);
    }

    // POST - Создать новый пост
    if (req.method === 'POST') {
      let content;
      
      // Парсим тело запроса
      if (req.headers['content-type'] === 'application/json') {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        content = parsed.content;
      } else {
        const body = await readBody(req);
        const params = new URLSearchParams(body);
        content = params.get('content');
      }

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

    // DELETE - Удалить пост
    if (req.method === 'DELETE') {
      const { id } = req.query;
      
      if (!id) {
        return res.status(400).json({ 
          error: 'ID поста обязателен' 
        });
      }

      const initialLength = db.posts.length;
      db.posts = db.posts.filter(post => post.id !== id);

      if (db.posts.length === initialLength) {
        return res.status(404).json({ 
          error: 'Пост не найден' 
        });
      }

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
