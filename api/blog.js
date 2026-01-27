import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DB_PATH = path.join('/tmp', 'blog-db-shop.json');

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ========== БАЗА ДАННЫХ ==========
async function initDB() {
  try {
    await fs.access(DB_PATH);
    console.log('База данных существует');
  } catch {
    console.log('Создаем новую базу данных с магазином');
    
    // Ассортимент магазина
    const shopItems = [
      { id: 'gift1', name: '🎁 Подарок', emoji: '🎁', price: 50, description: 'Простой подарок', category: 'basic' },
      { id: 'gift2', name: '❤️ Сердечко', emoji: '❤️', price: 100, description: 'Символ любви', category: 'hearts' },
      { id: 'gift3', name: '⭐ Звезда', emoji: '⭐', price: 150, description: 'Звезда удачи', category: 'stars' },
      { id: 'gift4', name: '🏆 Трофей', emoji: '🏆', price: 300, description: 'За достижения', category: 'trophies' },
      { id: 'gift5', name: '👑 Корона', emoji: '👑', price: 500, description: 'Королевский подарок', category: 'premium' },
      { id: 'gift6', name: '🎂 Торт', emoji: '🎂', price: 200, description: 'Сладкий сюрприз', category: 'food' },
      { id: 'gift7', name: '⚡ Молния', emoji: '⚡', price: 250, description: 'Энергия и скорость', category: 'energy' },
      { id: 'gift8', name: '💎 Алмаз', emoji: '💎', price: 1000, description: 'Роскошный подарок', category: 'premium' },
      { id: 'gift9', name: '🎈 Шарик', emoji: '🎈', price: 30, description: 'Веселый шарик', category: 'basic' },
      { id: 'gift10', name: '🎨 Палитра', emoji: '🎨', price: 180, description: 'Для творческих людей', category: 'art' }
    ];
    
    const initialData = {
      users: [
        {
          id: 'admin1',
          username: 'admin',
          passwordHash: hashPassword('admin123'),
          role: 'admin',
          quanta: 5000,
          inventory: [],
          giftsReceived: [],
          giftsSent: [],
          createdAt: new Date().toISOString()
        },
        {
          id: 'user1',
          username: 'user',
          passwordHash: hashPassword('user123'),
          role: 'user',
          quanta: 500,
          inventory: [
            { itemId: 'gift1', emoji: '🎁', name: '🎁 Подарок', receivedAt: new Date().toISOString() }
          ],
          giftsReceived: [],
          giftsSent: [],
          createdAt: new Date().toISOString()
        }
      ],
      posts: [
        {
          id: 'post1',
          content: 'Добро пожаловать в блог с магазином подарков!',
          authorId: 'admin1',
          authorName: 'admin',
          createdAt: new Date().toISOString()
        },
        {
          id: 'post2',
          content: 'Здесь можно покупать подарки за кванты и дарить их другим!',
          authorId: 'user1',
          authorName: 'user',
          createdAt: new Date().toISOString()
        }
      ],
      shop: {
        items: shopItems,
        lastUpdated: new Date().toISOString()
      },
      transactions: [],
      sessions: [],
      gifts: [], // История всех подарков
      settings: {
        quantaPerPost: 5,
        version: '3.0'
      }
    };
    
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
    console.log('База данных создана');
  }
}

async function readDB() {
  await initDB();
  const data = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ========== ПОЛЬЗОВАТЕЛЬСКИЕ ФУНКЦИИ ==========
async function validateToken(token) {
  try {
    const db = await readDB();
    const session = db.sessions?.find(s => s.token === token);
    
    if (!session) return null;
    
    const tokenAge = Date.now() - new Date(session.createdAt).getTime();
    const maxAge = session.role === 'admin' ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    
    if (tokenAge > maxAge) {
      db.sessions = db.sessions.filter(s => s.token !== token);
      await writeDB(db);
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
  } catch (error) {
    console.error('Ошибка валидации токена:', error);
    return null;
  }
}

async function addTransaction(userId, amount, reason, adminId = null) {
  const db = await readDB();
  const user = db.users.find(u => u.id === userId);
  
  if (!user) throw new Error('Пользователь не найден');
  
  user.quanta = (user.quanta || 0) + amount;
  
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

async function addToInventory(userId, item) {
  const db = await readDB();
  const user = db.users.find(u => u.id === userId);
  
  if (!user) throw new Error('Пользователь не найден');
  
  if (!user.inventory) user.inventory = [];
  
  const inventoryItem = {
    id: generateId(),
    itemId: item.id,
    emoji: item.emoji,
    name: item.name,
    purchasedAt: new Date().toISOString(),
    canSend: true
  };
  
  user.inventory.push(inventoryItem);
  
  await writeDB(db);
  return inventoryItem;
}

async function sendGift(senderId, receiverId, giftId, message = '') {
  const db = await readDB();
  
  const sender = db.users.find(u => u.id === senderId);
  const receiver = db.users.find(u => u.id === receiverId);
  
  if (!sender || !receiver) {
    throw new Error('Пользователь не найден');
  }
  
  // Найти подарок в инвентаре отправителя
  const giftIndex = sender.inventory?.findIndex(item => item.id === giftId);
  if (giftIndex === -1 || giftIndex === undefined) {
    throw new Error('Подарок не найден в инвентаре');
  }
  
  const gift = sender.inventory[giftIndex];
  
  // Удаляем у отправителя
  sender.inventory.splice(giftIndex, 1);
  
  // Добавляем получателю
  if (!receiver.giftsReceived) receiver.giftsReceived = [];
  if (!sender.giftsSent) sender.giftsSent = [];
  
  const giftRecord = {
    id: generateId(),
    giftId: gift.itemId,
    emoji: gift.emoji,
    name: gift.name,
    fromUserId: senderId,
    fromUsername: sender.username,
    toUserId: receiverId,
    toUsername: receiver.username,
    message: message,
    sentAt: new Date().toISOString()
  };
  
  receiver.giftsReceived.unshift(giftRecord);
  sender.giftsSent.unshift(giftRecord);
  
  // Сохраняем в общую историю подарков
  if (!db.gifts) db.gifts = [];
  db.gifts.unshift(giftRecord);
  
  await writeDB(db);
  return giftRecord;
}

// ========== ОСНОВНОЙ ОБРАБОТЧИК ==========
export default async function handler(req, res) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    
    // ========== PUBLIC ROUTES ==========
    
    // Регистрация
    if (pathname === '/api/blog/register' && req.method === 'POST') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Заполните все поля' });
      }
      
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ success: false, error: 'Имя пользователя 3-20 символов' });
      }
      
      if (password.length < 4) {
        return res.status(400).json({ success: false, error: 'Пароль минимум 4 символа' });
      }
      
      const db = await readDB();
      
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ success: false, error: 'Пользователь уже существует' });
      }
      
      const newUser = {
        id: generateId(),
        username,
        passwordHash: hashPassword(password),
        role: 'user',
        quanta: 100, // Начальный баланс
        inventory: [
          { 
            id: generateId(),
            itemId: 'welcome_gift',
            emoji: '🎁',
            name: 'Приветственный подарок',
            purchasedAt: new Date().toISOString(),
            canSend: true
          }
        ],
        giftsReceived: [],
        giftsSent: [],
        createdAt: new Date().toISOString()
      };
      
      db.users.push(newUser);
      
      // Начальная транзакция
      const transaction = {
        id: generateId(),
        userId: newUser.id,
        amount: 100,
        reason: 'Начальный бонус',
        timestamp: new Date().toISOString()
      };
      
      if (!db.transactions) db.transactions = [];
      db.transactions.unshift(transaction);
      
      await writeDB(db);
      
      return res.status(201).json({ 
        success: true,
        message: 'Регистрация успешна! Вы получили 100 квантов и подарок 🎁'
      });
    }
    
    // Вход
    if (pathname === '/api/blog/login' && req.method === 'POST') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Заполните все поля' });
      }
      
      const db = await readDB();
      const user = db.users.find(u => 
        u.username.toLowerCase() === username.toLowerCase() && 
        u.passwordHash === hashPassword(password)
      );
      
      if (!user) {
        return res.status(401).json({ success: false, error: 'Неверные данные' });
      }
      
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
        inventoryCount: user.inventory?.length || 0,
        createdAt: user.createdAt
      };
      
      return res.status(200).json({
        success: true,
        token,
        user: userData,
        message: 'Вход выполнен'
      });
    }
    
    // Магазин (публичный)
    if (pathname === '/api/blog/shop' && req.method === 'GET') {
      const db = await readDB();
      
      return res.status(200).json({
        success: true,
        shop: db.shop,
        message: 'Ассортимент магазина'
      });
    }
    
    // ========== PROTECTED ROUTES ==========
    const authHeader = req.headers.authorization;
    let currentUser = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      currentUser = await validateToken(token);
    }
    
    // ========== ПОСТЫ ==========
    
    // Все посты
    if (pathname === '/api/blog' && req.method === 'GET') {
      const db = await readDB();
      
      const sortedPosts = db.posts.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      const posts = sortedPosts.map(post => ({
        id: post.id,
        content: post.content,
        authorId: currentUser ? post.authorId : undefined,
        authorName: currentUser ? post.authorName : 'Пользователь',
        createdAt: post.createdAt,
        canDelete: currentUser ? (currentUser.id === post.authorId || currentUser.role === 'admin') : false
      }));
      
      return res.status(200).json({ success: true, posts });
    }
    
    // Создать пост
    if (pathname === '/api/blog' && req.method === 'POST') {
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const body = await readBody(req);
      const { content } = JSON.parse(body);
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Текст не может быть пустым' });
      }
      
      const db = await readDB();
      
      const newPost = {
        id: generateId(),
        content: content.trim(),
        authorId: currentUser.id,
        authorName: currentUser.username,
        createdAt: new Date().toISOString()
      };
      
      db.posts.unshift(newPost);
      
      // Начисляем кванты
      const quantaEarned = db.settings.quantaPerPost || 5;
      await addTransaction(currentUser.id, quantaEarned, 'Награда за пост');
      
      await writeDB(db);
      
      return res.status(201).json({
        success: true,
        post: newPost,
        quantaEarned,
        message: 'Пост создан! +5 квантов'
      });
    }
    
    // Удалить пост
    if (pathname === '/api/blog' && req.method === 'DELETE') {
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const id = url.searchParams.get('id');
      if (!id) {
        return res.status(400).json({ success: false, error: 'ID поста обязателен' });
      }
      
      const db = await readDB();
      const post = db.posts.find(p => p.id === id);
      
      if (!post) {
        return res.status(404).json({ success: false, error: 'Пост не найден' });
      }
      
      if (post.authorId !== currentUser.id && currentUser.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Недостаточно прав' });
      }
      
      db.posts = db.posts.filter(p => p.id !== id);
      await writeDB(db);
      
      return res.status(200).json({ 
        success: true,
        message: 'Пост удален',
        deletedByAdmin: currentUser.role === 'admin' && post.authorId !== currentUser.id
      });
    }
    
    // ========== ПОЛЬЗОВАТЕЛЬ ==========
    
    // Мой профиль
    if (pathname === '/api/blog/me' && req.method === 'GET') {
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const db = await readDB();
      const user = db.users.find(u => u.id === currentUser.id);
      
      if (!user) {
        return res.status(404).json({ success: false, error: 'Пользователь не найден' });
      }
      
      const userData = {
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        createdAt: user.createdAt,
        postCount: db.posts.filter(p => p.authorId === user.id).length,
        inventory: user.inventory || [],
        giftsReceived: user.giftsReceived?.slice(0, 10) || [],
        giftsSent: user.giftsSent?.slice(0, 10) || []
      };
      
      // Последние транзакции
      const recentTransactions = db.transactions
        ?.filter(t => t.userId === user.id)
        ?.slice(0, 10) || [];
      
      return res.status(200).json({
        success: true,
        user: userData,
        recentTransactions
      });
    }
    
    // ========== МАГАЗИН (защищенные маршруты) ==========
    
    // Купить предмет
    if (pathname === '/api/blog/shop/buy' && req.method === 'POST') {
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const body = await readBody(req);
      const { itemId } = JSON.parse(body);
      
      if (!itemId) {
        return res.status(400).json({ success: false, error: 'Выберите предмет' });
      }
      
      const db = await readDB();
      const user = db.users.find(u => u.id === currentUser.id);
      const item = db.shop.items.find(i => i.id === itemId);
      
      if (!item) {
        return res.status(404).json({ success: false, error: 'Товар не найден' });
      }
      
      if (user.quanta < item.price) {
        return res.status(400).json({ 
          success: false, 
          error: `Недостаточно квантов. Нужно: ${item.price}, у вас: ${user.quanta}` 
        });
      }
      
      // Списываем кванты
      user.quanta -= item.price;
      
      // Добавляем в инвентарь
      const inventoryItem = {
        id: generateId(),
        itemId: item.id,
        emoji: item.emoji,
        name: item.name,
        price: item.price,
        purchasedAt: new Date().toISOString(),
        canSend: true
      };
      
      if (!user.inventory) user.inventory = [];
      user.inventory.push(inventoryItem);
      
      // Записываем транзакцию
      const transaction = {
        id: generateId(),
        userId: user.id,
        amount: -item.price,
        reason: `Покупка: ${item.name}`,
        timestamp: new Date().toISOString()
      };
      
      db.transactions.unshift(transaction);
      await writeDB(db);
      
      return res.status(200).json({
        success: true,
        item: inventoryItem,
        newBalance: user.quanta,
        message: `Вы купили ${item.emoji} ${item.name} за ${item.price} квантов!`
      });
    }
    
    // Отправить подарок
    if (pathname === '/api/blog/gifts/send' && req.method === 'POST') {
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const body = await readBody(req);
      const { receiverId, giftId, message } = JSON.parse(body);
      
      if (!receiverId || !giftId) {
        return res.status(400).json({ success: false, error: 'Заполните все поля' });
      }
      
      if (currentUser.id === receiverId) {
        return res.status(400).json({ success: false, error: 'Нельзя отправить подарок самому себе' });
      }
      
      try {
        const giftRecord = await sendGift(currentUser.id, receiverId, giftId, message || '');
        
        return res.status(200).json({
          success: true,
          gift: giftRecord,
          message: `Вы отправили ${giftRecord.emoji} пользователю ${giftRecord.toUsername}!`
        });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    }
    
    // Поиск пользователей для отправки подарков
    if (pathname === '/api/blog/users/search' && req.method === 'GET') {
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const search = url.searchParams.get('q') || '';
      const db = await readDB();
      
      let users = db.users
        .filter(u => u.id !== currentUser.id) // Исключаем себя
        .map(u => ({
          id: u.id,
          username: u.username,
          role: u.role
        }));
      
      if (search) {
        users = users.filter(u => 
          u.username.toLowerCase().includes(search.toLowerCase())
        );
      }
      
      return res.status(200).json({
        success: true,
        users: users.slice(0, 20)
      });
    }
    
    // ========== АДМИНКА ==========
    
    // Статистика
    if (pathname === '/api/blog/admin/stats' && req.method === 'GET') {
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Требуются права администратора' });
      }
      
      const db = await readDB();
      
      const stats = {
        totalUsers: db.users.length,
        totalPosts: db.posts.length,
        totalQuanta: db.users.reduce((sum, u) => sum + (u.quanta || 0), 0),
        totalGifts: db.gifts?.length || 0,
        shopItems: db.shop.items.length,
        settings: db.settings
      };
      
      return res.status(200).json({ success: true, stats });
    }
    
    // Все пользователи
    if (pathname === '/api/blog/admin/users' && req.method === 'GET') {
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Требуются права администратора' });
      }
      
      const db = await readDB();
      
      const users = db.users.map(user => ({
        id: user.id,
        username: user.username,
        role: user.role,
        quanta: user.quanta || 0,
        inventoryCount: user.inventory?.length || 0,
        createdAt: user.createdAt,
        postCount: db.posts.filter(p => p.authorId === user.id).length
      }));
      
      return res.status(200).json({ success: true, users });
    }
    
    // Добавить кванты
    if (pathname === '/api/blog/admin/add-quanta' && req.method === 'POST') {
      if (!currentUser || currentUser.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Требуются права администратора' });
      }
      
      const body = await readBody(req);
      const { userId, amount, reason } = JSON.parse(body);
      
      if (!userId || !amount || !reason) {
        return res.status(400).json({ success: false, error: 'Заполните все поля' });
      }
      
      try {
        const newBalance = await addTransaction(userId, amount, reason, currentUser.id);
        
        return res.status(200).json({
          success: true,
          message: `Добавлено ${amount} квантов`,
          newBalance
        });
      } catch (error) {
        return res.status(404).json({ success: false, error: error.message });
      }
    }
    
    // Маршрут не найден
    return res.status(404).json({
      success: false,
      error: 'Маршрут не найден',
      availableRoutes: [
        'POST /api/blog/register',
        'POST /api/blog/login',
        'GET /api/blog/shop',
        'GET /api/blog (auth)',
        'POST /api/blog (auth)',
        'DELETE /api/blog?id= (auth)',
        'GET /api/blog/me (auth)',
        'POST /api/blog/shop/buy (auth)',
        'POST /api/blog/gifts/send (auth)',
        'GET /api/blog/users/search (auth)',
        'GET /api/blog/admin/stats (admin)',
        'GET /api/blog/admin/users (admin)',
        'POST /api/blog/admin/add-quanta (admin)'
      ]
    });
    
  } catch (error) {
    console.error('Критическая ошибка сервера:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
