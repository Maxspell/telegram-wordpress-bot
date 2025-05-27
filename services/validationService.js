class ValidationService {
    constructor() {
        // Регулярные выражения для валидации
        this.patterns = {
            email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
            phone: /^(\+7|8)[\d\s\-\(\)]{10,15}$/,
            name: /^[а-яёА-ЯЁa-zA-Z\s\-]{2,50}$/
        };
    }

    /**
     * Валидация имени
     * @param {string} name - Имя для проверки
     * @returns {boolean}
     */
    validateName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        const trimmedName = name.trim();
        
        // Проверка длины
        if (trimmedName.length < 2 || trimmedName.length > 50) {
            return false;
        }

        // Проверка на корректные символы
        if (!this.patterns.name.test(trimmedName)) {
            return false;
        }

        // Проверка на наличие цифр
        if (/\d/.test(trimmedName)) {
            return false;
        }

        // Проверка на подозрительные паттерны
        const suspiciousPatterns = [
            /test/i,
            /admin/i,
            /bot/i,
            /spam/i,
            /fake/i,
            /qwerty/i,
            /asdf/i,
            /^[a-z]+$/i, // только одни строчные или заглавные буквы
            /(.)\1{3,}/ // повторяющиеся символы более 3 раз
        ];

        return !suspiciousPatterns.some(pattern => pattern.test(trimmedName));
    }

    /**
     * Валидация номера телефона
     * @param {string} phone - Номер телефона
     * @returns {boolean}
     */
    validatePhone(phone) {
        if (!phone || typeof phone !== 'string') {
            return false;
        }

        // Убираем все пробелы, скобки, дефисы
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
        
        // Проверка базового формата
        if (!this.patterns.phone.test(phone)) {
            return false;
        }

        // Дополнительные проверки
        if (cleanPhone.startsWith('+38')) {
            return cleanPhone.length === 13; // +38XXXXXXXXXX
        } else if (cleanPhone.startsWith('0')) {
            return cleanPhone.length === 11; // 0XXXXXXXXXX
        }

        return false;
    }

    /**
     * Нормализация номера телефона
     * @param {string} phone - Номер телефона
     * @returns {string}
     */
    normalizePhone(phone) {
        if (!this.validatePhone(phone)) {
            return phone;
        }

        let cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
        
        // Приводим к формату +7XXXXXXXXXX
        if (cleanPhone.startsWith('8')) {
            cleanPhone = '+38' + cleanPhone.substring(1);
        } else if (!cleanPhone.startsWith('+38')) {
            cleanPhone = '+38' + cleanPhone;
        }

        return cleanPhone;
    }

    /**
     * Валидация email адреса
     * @param {string} email - Email адрес
     * @returns {boolean}
     */
    validateEmail(email) {
        if (!email || typeof email !== 'string') {
            return false;
        }

        const trimmedEmail = email.trim().toLowerCase();
        
        // Базовая проверка формата
        if (!this.patterns.email.test(trimmedEmail)) {
            return false;
        }

        // Проверка длины
        if (trimmedEmail.length > 254) {
            return false;
        }

        // Проверка доменной части
        const domain = trimmedEmail.split('@')[1];
        if (!domain || domain.length > 253) {
            return false;
        }

        // Блокировка одноразовых email сервисов
        const disposableEmailDomains = [
            '10minutemail.com',
            'guerrillamail.com',
            'mailinator.com',
            'tempmail.org',
            'throwaway.email',
            'temp-mail.org',
            'yopmail.com'
        ];

        if (disposableEmailDomains.includes(domain)) {
            return false;
        }

        // Проверка на подозрительные паттерны
        const suspiciousPatterns = [
            /test/i,
            /spam/i,
            /fake/i,
            /admin@admin/i,
            /noreply/i,
            /no-reply/i
        ];

        return !suspiciousPatterns.some(pattern => pattern.test(trimmedEmail));
    }

    /**
     * Валидация сообщения
     * @param {string} message - Сообщение
     * @returns {boolean}
     */
    validateMessage(message) {
        if (typeof message !== 'string') {
            return false;
        }

        // Проверка длины
        if (message.length > 1000) {
            return false;
        }

        // Проверка на спам
        const spamPatterns = [
            /(.)\1{10,}/, // Повторяющиеся символы
            /(https?:\/\/[^\s]+){3,}/, // Множественные ссылки
            /СКИДКА|АКЦИЯ|СРОЧНО|ВЫГОДА/gi, // Спам слова
            /<script|javascript:|onclick/i, // Потенциально опасный код
            /\$\d+|\d+\$|\d+руб/g // Упоминание денег
        ];

        return !spamPatterns.some(pattern => pattern.test(message));
    }

    /**
     * Проверка на флуд (частые сообщения)
     * @param {number} userId - ID пользователя
     * @param {number} timeWindow - Временное окно в секундах
     * @param {number} maxMessages - Максимальное количество сообщений
     * @returns {boolean}
     */
    checkFlood(userId, timeWindow = 60, maxMessages = 5) {
        const now = Date.now();
        const windowStart = now - (timeWindow * 1000);

        // Инициализируем хранилище для пользователя
        if (!this.userMessages) {
            this.userMessages = new Map();
        }

        if (!this.userMessages.has(userId)) {
            this.userMessages.set(userId, []);
        }

        const messages = this.userMessages.get(userId);
        
        // Удаляем старые сообщения
        const recentMessages = messages.filter(timestamp => timestamp > windowStart);
        
        // Обновляем список
        this.userMessages.set(userId, recentMessages);
        
        // Добавляем текущее сообщение
        recentMessages.push(now);
        
        return recentMessages.length <= maxMessages;
    }

    /**
     * Санитизация входных данных
     * @param {string} input - Входная строка
     * @returns {string}
     */
    sanitize(input) {
        if (typeof input !== 'string') {
            return '';
        }

        return input
            .trim()
            .replace(/[<>]/g, '') // Удаляем HTML теги
            .replace(/script/gi, '') // Удаляем потенциально опасные слова
            .replace(/javascript/gi, '')
            .replace(/onclick/gi, '')
            .substring(0, 1000); // Ограничиваем длину
    }
}

module.exports = ValidationService;