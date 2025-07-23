const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { title } = require('process');

class WordPressAPI {
    constructor() {
        this.baseURL = process.env.WORDPRESS_URL;
        this.username = process.env.WP_USERNAME; // WordPress username
        this.appPassword = process.env.WP_APP_PASSWORD; // Application password
        // this.apiKey = process.env.WP_API_KEY;
        // this.apiSecret = process.env.WP_API_SECRET;
        this.timeout = 10000; // 10 секунд
        
        // Настройка axios
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'TelegramBot/1.0'
            }
        });

        // Добавляем интерцепторы
        this.setupInterceptors();
    }

    setupInterceptors() {
        // Request interceptor для добавления авторизации
        this.client.interceptors.request.use(
            (config) => {
                // Добавляем HMAC подпись для безопасности
                // const timestamp = Date.now().toString();
                // const signature = this.generateSignature(config.data, timestamp);
                
                // config.headers['X-API-Key'] = this.apiKey;
                // config.headers['X-Timestamp'] = timestamp;
                // config.headers['X-Signature'] = signature;

                const credentials = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
                config.headers['Authorization'] = `Basic ${credentials}`;

                logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                logger.error('Request interceptor error:', error);
                return Promise.reject(error);
            }
        );

        // Response interceptor для обработки ответов
        this.client.interceptors.response.use(
            (response) => {
                logger.debug(`API Response: ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                if (error.response) {
                    logger.error(`API Error: ${error.response.status} ${error.response.statusText}`);
                    logger.error('Error data:', error.response.data);
                } else if (error.request) {
                    logger.error('Network error:', error.message);
                } else {
                    logger.error('Request setup error:', error.message);
                }
                return Promise.reject(error);
            }
        );
    }

    /**
     * Генерация HMAC подписи для безопасности
     * @param {Object} data - Данные запроса
     * @param {string} timestamp - Временная метка
     * @returns {string}
     */
    generateSignature(data, timestamp) {
        const payload = JSON.stringify(data) + timestamp;
        return crypto
            .createHmac('sha256', this.apiSecret)
            .update(payload)
            .digest('hex');
    }

    /**
     * Отправка данных пользователя в WordPress
     * @param {Object} userData - Данные пользователя
     * @returns {Promise<Object>}
     */
    async submitUserData(userData) {
        try {
            // Подготавливаем данные
            const payload = {
                telegram_id: userData.telegram_id,
                title: userData.name,
                name: userData.name,
                phone: userData.phone,
                email: userData.email,
                message: userData.message
            };

            // Валидация данных перед отправкой
            if (!this.validateSubmissionData(payload)) {
                throw new Error('Invalid submission data');
            }

            const response = await this.client.post('/wp-json/wp/v2/telegram_leads', payload);

            logger.info(`Response data: ${JSON.stringify(response.data)}`);
            logger.info(`Response status: ${response.status}`);

            if (response.status >= 200 && response.status < 300) {
                logger.info(`Successfully submitted data for telegram user ${userData.telegram_id}`);
                return {
                    success: true,
                    id: response.data.id,
                    message: response.data.message || 'Data submitted successfully'
                };
            } else {
                throw new Error(response.data?.error || 'Unknown error from WordPress');
            }

        } catch (error) {
            logger.error(`Error submitting data to WordPress: ${error.message}`);
            
            // Попытка повторной отправки через некоторое время
            if (error.code === 'ECONNABORTED' || error.response?.status >= 500) {
                logger.info('Attempting retry...');
                return await this.retrySubmission(userData, 1);
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Повторная попытка отправки данных
     * @param {Object} userData - Данные пользователя
     * @param {number} attempt - Номер попытки
     * @returns {Promise<Object>}
     */
    async retrySubmission(userData, attempt) {
        const maxRetries = 3;
        const delay = attempt * 2000; // Увеличиваем задержку с каждой попыткой

        if (attempt > maxRetries) {
            logger.error(`Max retries (${maxRetries}) exceeded for user ${userData.telegram_id}`);
            return {
                success: false,
                error: 'Max retries exceeded'
            };
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        
        try {
            logger.info(`Retry attempt ${attempt} for user ${userData.telegram_id}`);
            return await this.submitUserData(userData);
        } catch (error) {
            return await this.retrySubmission(userData, attempt + 1);
        }
    }

    /**
     * Валидация данных перед отправкой
     * @param {Object} data - Данные для валидации
     * @returns {boolean}
     */
    validateSubmissionData(data) {
        const requiredFields = ['telegram_id', 'title', 'phone'];
        
        for (const field of requiredFields) {
            if (!data[field]) {
                logger.error(`Missing required field: ${field}`);
                return false;
            }
        }

        // Проверка email если присутствует
        if (data.email && !this.isValidEmail(data.email)) {
            logger.error('Invalid email format');
            return false;
        }

        // Проверка телефона
        if (!this.isValidPhone(data.phone)) {
            logger.error(`Invalid phone format: ${data.phone}`);
            logger.error('Invalid phone format');
            return false;
        }

        return true;
    }

    /**
     * Проверка корректности email
     * @param {string} email - Email адрес
     * @returns {boolean}
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Проверка корректности телефона
     * @param {string} phone - Номер телефона
     * @returns {boolean}
     */
    isValidPhone(phone) {
        const phoneRegex = /^(\+380|0)\d{9}$/;
        return phoneRegex.test(phone);
    }

    /**
     * Получение статуса заявки
     * @param {number} submissionId - ID заявки
     * @returns {Promise<Object>}
     */
    async getSubmissionStatus(submissionId) {
        try {
            const response = await this.client.get(`/wp-json/telegram-bot/v1/status/${submissionId}`);
            
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            logger.error('Error getting submission status:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Получение истории заявок пользователя
     * @param {number} telegramId - Telegram ID пользователя
     * @returns {Promise<Object>}
     */
    async getUserSubmissions(telegramId) {
        try {
            const response = await this.client.get(`/wp-json/telegram-bot/v1/user/${telegramId}/submissions`);
            
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            logger.error('Error getting user submissions:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Отправка уведомления в WordPress о новой активности
     * @param {Object} eventData - Данные события
     * @returns {Promise<void>}
     */
    async sendActivityNotification(eventData) {
        try {
            await this.client.post('/wp-json/telegram-bot/v1/activity', {
                type: eventData.type,
                user_id: eventData.userId,
                data: eventData.data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.warn('Failed to send activity notification:', error.message);
            // Не останавливаем выполнение при ошибке уведомлений
        }
    }

    /**
     * Проверка здоровья API
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            const response = await this.client.get('/wp-json/telegram-bot/v1/health');
            return response.status === 200 && response.data?.status === 'ok';
        } catch (error) {
            logger.error('Health check failed:', error.message);
            return false;
        }
    }
}

module.exports = WordPressAPI;