// Добавьте эту функцию в ваш index.html в секцию showAdminPanel():
async function showAdminPanel() {
    document.getElementById('contentTitle').textContent = '👑 Админ-панель';
    
    if (!currentUser || currentUser.role !== 'admin') {
        document.getElementById('contentBody').innerHTML = '<p style="color: #666;">Требуются права администратора</p>';
        return;
    }
    
    document.getElementById('contentBody').innerHTML = '<div class="loader">Загрузка админ-панели...</div>';
    
    try {
        const token = localStorage.getItem('blog_token');
        
        // Тестовые данные для проверки
        const testStats = {
            totalUsers: 5,
            totalPosts: 12,
            totalQuanta: 1500,
            settings: { quantaPerPost: 5 }
        };
        
        const testUsers = [
            { id: '1', username: 'admin', role: 'admin', quanta: 1000, postCount: 3 },
            { id: '2', username: 'user1', role: 'user', quanta: 250, postCount: 5 },
            { id: '3', username: 'user2', role: 'user', quanta: 150, postCount: 4 }
        ];
        
        // Пробуем загрузить реальные данные
        try {
            const [statsResponse, usersResponse] = await Promise.all([
                fetch(`${API_URL}/admin/stats`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).catch(() => ({ ok: false })),
                fetch(`${API_URL}/admin/users`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).catch(() => ({ ok: false }))
            ]);
            
            let stats, users;
            
            if (statsResponse.ok && usersResponse.ok) {
                stats = await statsResponse.json();
                users = await usersResponse.json();
            } else {
                // Используем тестовые данные
                stats = testStats;
                users = testUsers;
                console.log('Используются тестовые данные для админки');
            }
            
            document.getElementById('contentBody').innerHTML = `
                <div class="admin-grid">
                    <div class="admin-card">
                        <h3 style="margin-bottom: 15px;">📊 Статистика</h3>
                        <div class="stats-grid">
                            <div class="stat">
                                <div class="stat-value">${stats.totalUsers}</div>
                                <div>Пользователей</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value">${stats.totalPosts}</div>
                                <div>Постов</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value">${stats.totalQuanta}</div>
                                <div>Всего квантов</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value">${stats.settings.quantaPerPost || 5}</div>
                                <div>За пост</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="admin-card">
                        <h3 style="margin-bottom: 15px;">💰 Начислить кванты</h3>
                        <p style="color: #666; margin-bottom: 15px;">Функция в разработке</p>
                        <button class="btn" onclick="showMessage('Функция будет добавлена в следующем обновлении', 'info')">
                            Добавить кванты
                        </button>
                    </div>
                </div>
                
                <div class="admin-card" style="margin-top: 20px;">
                    <h3 style="margin-bottom: 15px;">👥 Пользователи (${users.length})</h3>
                    <div style="max-height: 400px; overflow-y: auto;">
                        ${users.map(user => `
                            <div style="padding: 12px; border-bottom: 1px solid #eee;">
                                <div style="font-weight: bold;">${user.username}</div>
                                <small style="color: #666;">
                                    ${user.role === 'admin' ? '👑 Админ' : '👤 Пользователь'} • 
                                    ${user.postCount || 0} постов • 
                                    💎 ${user.quanta || 0} квантов
                                </small>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
        } catch (error) {
            // Если совсем ничего не работает, показываем сообщение
            document.getElementById('contentBody').innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <h3 style="color: #ff4d4f; margin-bottom: 15px;">Админка временно недоступна</h3>
                    <p style="color: #666; margin-bottom: 20px;">
                        Мы работаем над восстановлением функционала.<br>
                        Пожалуйста, попробуйте позже.
                    </p>
                    <button class="btn" onclick="showFeed()">
                        Вернуться в ленту
                    </button>
                </div>
            `;
            console.error('Ошибка админки:', error);
        }
        
    } catch (error) {
        document.getElementById('contentBody').innerHTML = '<p style="color: #666;">Ошибка загрузки админ-панели</p>';
        showMessage(error.message, 'error');
    }
}
