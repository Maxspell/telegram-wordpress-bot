const logger = require('../utils/logger');

class UserController {
    constructor() {
        // Кэш для хранения данных пользователей в памяти
        this.userCache = new Map();
        this.userStats = new Map();
        
        // Очистка кэша каждые 30 минут
        setInterval(() => {
            this.cleanupCache();
        }, 30 * 60 * 1000);
    }

    /**
     * Получение данных пользователя
     * @param {number} userId - Telegram ID пользователя
     * @returns {Object|null}
     */
    getUser(userId) {
        return this.userCache.get(userId) || null;
    }

    /**
     * Сохранение данных пользователя
     * @param {number} userId - Telegram ID пользователя
     * @param {Object} userData - Данные пользователя
     */
    setUser(userId, userData) {
        const user = {
            ...userData,
            lastActivity: new Date(),
            createdAt: this.userCache.has(userId) ? 
                this.userCache.get(userId).createdAt : new Date()
        };
        
        this.userCache.set(userId, user);
        this.updateUserStats(userId, 'data_updated');
        
        logger.telegram(userId, 'user_data_updated', {
            fields: Object.keys(userData)
        });
    }

    /**
     * Обновление активности пользователя
     * @param {number} userId - Telegram ID пользователя
     * @param {string} action - Выполненное действие
     * @param {Object} metadata - Дополнительные данные
     */
    updateActivity(userId, action, metadata = {}) {
        const user = this.userCache.get(userId);
        if (user) {
            user.lastActivity = new Date();
            user.lastAction = action;
            this.userCache.set(userId, user);
        }

        this.updateUserStats(userId, action);
        
        logger.telegram(userId, action, metadata);
    }

    /**
     * Обновление статистики пользователя
     * @param {number} userId - Telegram ID пользователя
     * @param {string} action - Выполненное действие
     */
    updateUserStats(userId, action) {
        if (!this.userStats.has(userId)) {
            this.userStats.set(userId, {
                totalActions: 0,
                actions: {},
                firstSeen: new Date(),
                lastSeen: new Date()
            });
        }

        const stats = this.userStats.get(userId);
        stats.totalActions++;
        stats.actions[action] = (stats.actions[action] || 0) + 1;
        stats.lastSeen = new Date();
        
        this.userStats.set(userId, stats);
    }

    /**
     * Получение статистики пользователя
     * @param {number} userId - Telegram ID пользователя
     * @returns {Object|null}
     */
    getUserStats(userId) {
        return this.userStats.get(userId) || null;
    }

    /**
     * Проверка на подозрительную активность
     * @param {number} userId - Telegram ID пользователя
     * @returns {Object}
     */
    checkSuspiciousActivity(userId) {
        const stats = this.getUserStats(userId);
        if (!stats) {
            return { suspicious: false };
        }

        const suspiciousIndicators = [];
        
        // Слишком много действий за короткое время
        const timeDiff = (new Date() - stats.firstSeen) / 1000 / 60; // в минутах
        const actionsPerMinute = stats.totalActions / Math.max(timeDiff, 1);
        
        if (actionsPerMinute > 10) {
            suspiciousIndicators.push('high_frequency');
        }

        // Повторяющиеся попытки отправки
        if (stats.actions.submit_attempt > 5) {
            suspiciousIndicators.push('multiple_submit_attempts');
        }

        // Много отмен подряд
        if (stats.actions.cancel > 10) {
            suspiciousIndicators.push('excessive_cancellations');
        }

        const suspicious = suspiciousIndicators.length > 0;
        
        if (suspicious) {
            logger.security('suspicious_activity_detected', userId, {
                indicators: suspiciousIndicators,
                stats: stats
            });
        }

        return {
            suspicious,
            indicators: suspiciousIndicators,
            riskScore: this.calculateRiskScore(stats)
        };
    }

    /**
     * Расчет риск-скора пользователя
     * @param {Object} stats - Статистика пользователя
     * @returns {number} Риск-скор от 0 до 100
     */
    calculateRiskScore(stats) {
        let score = 0;
        
        // Частота действий
        const timeDiff = (new Date() - stats.firstSeen) / 1000 / 60;
        const actionsPerMinute = stats.totalActions / Math.max(timeDiff, 1);
        if (actionsPerMinute > 5) score += 30;
        if (actionsPerMinute > 10) score += 40;

        // Неуспешные попытки
        const failureRate = (stats.actions.validation_failed || 0) / stats.totalActions;
        if (failureRate > 0.5) score += 25;

        // Много отмен
        const cancelRate = (stats.actions.cancel || 0) / stats.totalActions;
        if (cancelRate > 0.3) score += 20;

        // Подозрительные паттерны
        if (stats.actions.start > 10) score += 15;
        if (stats.actions.submit_attempt > 5) score += 25;

        return Math.min(score, 100);
    }

    /**
     * Блокировка пользователя
     * @param {number} userId - Telegram ID пользователя
     * @param {string} reason - Причина блокировки
     * @param {number} duration - Длительность блокировки в минутах
     */
    blockUser(userId, reason, duration = 60) {
        const blockData = {
            blocked: true,
            reason: reason,
            blockedAt: new Date(),
            blockedUntil: new Date(Date.now() + duration * 60 * 1000)
        };

        const user = this.userCache.get(userId) || {};
        this.userCache.set(userId, { ...user, ...blockData });

        logger.security('user_blocked', userId, {
            reason,
            duration,
            blockedUntil: blockData.blockedUntil
        });
    }

    /**
     * Проверка блокировки пользователя
     * @param {number} userId - Telegram ID пользователя
     * @returns {Object}
     */
    checkUserBlock(userId) {
        const user = this.userCache.get(userId);
        
        if (!user || !user.blocked) {
            return { blocked: false };
        }

        // Проверяем истекла ли блокировка
        if (new Date() > user.blockedUntil) {
            // Разблокируем пользователя
            user.blocked = false;
            delete user.reason;
            delete user.blockedAt;
            delete user.blockedUntil;
            this.userCache.set(userId, user);
            
            logger.security('user_unblocked', userId, { reason: 'timeout_expired' });
            return { blocked: false };
        }

        return {
            blocked: true,
            reason: user.reason,
            blockedUntil: user.blockedUntil,
            remainingTime: Math.ceil((user.blockedUntil - new Date()) / 1000 / 60) // в минутах
        };
    }

    /**
     * Получение активных пользователей
     * @param {number} minutes - За сколько минут считать активность
     * @returns {Array}
     */
    getActiveUsers(minutes = 60) {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        const activeUsers = [];

        for (const [userId, user] of this.userCache.entries()) {
            if (user.lastActivity && user.lastActivity > cutoff) {
                activeUsers.push({
                    userId,
                    lastActivity: user.lastActivity,
                    lastAction: user.lastAction
                });
            }
        }

        return activeUsers.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    /**
     * Получение общей статистики
     * @returns {Object}
     */
    getOverallStats() {
        const now = new Date();
        const hour = 60 * 60 * 1000;
        const day = 24 * hour;

        let totalUsers = this.userCache.size;
        let activeLastHour = 0;
        let activeLastDay = 0;
        let blockedUsers = 0;
        let totalActions = 0;

        for (const [userId, user] of this.userCache.entries()) {
            if (user.blocked) blockedUsers++;
            
            if (user.lastActivity) {
                const timeDiff = now - user.lastActivity;
                if (timeDiff < hour) activeLastHour++;
                if (timeDiff < day) activeLastDay++;
            }

            const stats = this.userStats.get(userId);
            if (stats) {
                totalActions += stats.totalActions;
            }
        }

        return {
            totalUsers,
            activeLastHour,
            activeLastDay,
            blockedUsers,
            totalActions,
            cacheSize: this.userCache.size,
            statsSize: this.userStats.size
        };
    }

    /**
     * Очистка устаревших данных из кэша
     */
    cleanupCache() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 часа
        let cleaned = 0;

        for (const [userId, user] of this.userCache.entries()) {
            if (!user.lastActivity || user.lastActivity < cutoff) {
                this.userCache.delete(userId);
                this.userStats.delete(userId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.info(`Cache cleanup: removed ${cleaned} inactive users`);
        }
    }

    /**
     * Экспорт данных пользователя для отладки
     * @param {number} userId - Telegram ID пользователя
     * @returns {Object}
     */
    exportUserData(userId) {
        return {
            user: this.userCache.get(userId),
            stats: this.userStats.get(userId),
            block: this.checkUserBlock(userId),
            suspicious: this.checkSuspiciousActivity(userId)
        };
    }
}

module.exports = UserController;