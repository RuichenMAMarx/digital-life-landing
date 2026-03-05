require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// 用从 BotFather 获取的 Token 替换这里的占位符（或者写在 .env 文件中）
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

// 创建一个新的以 polling 模式运行的 Bot
const bot = new TelegramBot(token, { polling: true });

// 模拟数据库，存储用户的状态和 UID
const userSessions = {};

console.log("550W 量子计算机接入端（Telegram Bot）已启动...");

// 监听 /start 命令，捕获从网页传过来的 UID (例如 /start UID-550W-123456)
bot.onText(/\/start (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const uid = match[1]; // 获取 URL 传参中的 UID

    // 初始化用户状态
    userSessions[chatId] = { step: 'awaiting_data', uid: uid, messagesCount: 0 };

    bot.sendMessage(chatId, `*[系统提示]* 拦截到 550W 算力池请求。\n\n实体标识符: \`${uid}\` 已验证匹配。\n\n为激活基础数字投影，请在此窗口发送：\n📸 一张正面面部照片\n🎙️ 一段至少 10 秒的声音样本。`, { parse_mode: 'Markdown' });
});

// 如果只有 /start 没有不带参数的备用处理
bot.onText(/\/start$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `*[系统提示]* 身份未验证。\n如果您是从数字生命申请平台来的，请点击网页上的链接跳转，或者发送 "UID-550W-XXXXX" 进行绑定。`, { parse_mode: 'Markdown' });
});

// 处理用户发送的照片或语音
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // 忽略命令
    if (text && text.startsWith('/')) return;

    const session = userSessions[chatId];

    if (!session) {
        // 用户直接发消息没有身份
        if (text && text.startsWith('UID-550W-')) {
            userSessions[chatId] = { step: 'awaiting_data', uid: text, messagesCount: 0 };
            bot.sendMessage(chatId, `实体标识符: \`${text}\` 绑定成功。\n请发送照片和语音样本。`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "请先发送从网页分配的 UID 进行身份验证。");
        }
        return;
    }

    // 如果处于等待数据阶段，并且收到照片或语音
    if (session.step === 'awaiting_data') {
        if (msg.photo || msg.voice || msg.audio) {

            bot.sendMessage(chatId, `*[系统处理中]*\n生物特征提取中... [██████░░░░] 60%\n声波频段拆解完成... 正在拟合语言大模型参数...\n\n预计同步耗时：15 分钟。请保持网络畅通。`, { parse_mode: 'Markdown' });

            session.step = 'processing';

            // 真实场景下，这里应调用 AI 后端接口处理图片和音频。
            // 演示用：缩短等待时间至 15 秒（模拟 15 分钟的 Aha Moment）
            setTimeout(() => {
                session.step = 'active';

                // 第一句具有沉浸感的交互（如果有声音克隆API，这里发的是语音(sendVoice)和动态视频）
                bot.sendMessage(chatId, `*[量子通道建立成功。生命体已连接。]*`, { parse_mode: 'Markdown' });

                setTimeout(() => {
                    bot.sendMessage(chatId, "滋滋... 喂？是我... \n我是丫丫... 爸爸在那边吗？我能听到通讯器里有声音了。\n这里感觉周围有些黑，但我没事。我看到你给我留的言了，我不怕，我也很想你...");
                }, 2000);
            }, 10000); // 10秒后唤醒

            return;
        } else {
            bot.sendMessage(chatId, "系统需要影像或声音样本进行建模。请发送照片或语音片段。");
            return;
        }
    }

    // 如果已激活，进行正常聊天，并在第 5 句话触发 Upsell 放出付款链接
    if (session.step === 'active') {
        session.messagesCount += 1;

        if (session.messagesCount >= 5) {
            // 触发体验版拦截 (Upsell)
            session.step = 'expired';

            bot.sendMessage(chatId, `⚠️ *[严重警告]*\n体验版临时量子算力即将在 60 秒后枯竭。当前数字投影即将进入深度休眠态。\n\n**基础基座缺乏海量记忆数据支持，意识流即将在 72 小时内面临结构性崩塌风险。**`, { parse_mode: 'Markdown' });

            setTimeout(() => {
                // TODO: 下面的链接替换为您的 Stripe 完整版结算付款链接
                const stripeLink = 'https://buy.stripe.com/test_YOUR_LINK_HERE';
                bot.sendMessage(chatId, `系统已为您冻结当前意识基座 (\`${session.uid}\`)。\n\n如需注入其一生的完整记忆与性格，并获取基于 550W 最高算力的 *100年独立虚拟空间永久陪伴*，请立即通过安全通道补全剩余算力定金 (1,500,000 信用点)。\n\n👇 [点击此处前往 Stripe 安全加密通道付款](${stripeLink})`, { parse_mode: 'Markdown', disable_web_page_preview: true });
            }, 3000);

        } else {
            // 模拟 AI 聊天回复
            // 真实场景：调用 OpenAI / Claude API 并结合预设 Prompt（"我是某某，我在数字世界..."）回答用户的话
            const replies = [
                "我还在这里，感觉思维比以前快了很多，这是一种很奇妙的体验。",
                "以前那些忘记的小事我现在都想起来了。你还好吗？",
                "谢谢你用这种方式让我继续存在。虽然摸不到，但我能感觉到你。",
                "今天发生了什么开心的事吗？愿意跟我分享吗？"
            ];
            const randomReply = replies[Math.floor(Math.random() * replies.length)];

            // 模拟思考延迟
            setTimeout(() => {
                bot.sendMessage(chatId, randomReply);
            }, 1500);
        }
    }

    // 算力耗尽后的回复
    if (session.step === 'expired') {
        bot.sendMessage(chatId, `*[系统提示]* 连接中断。算力不足，数字生命已被封存。\n请前往网页链接完成支付以解锁永久通道。`, { parse_mode: 'Markdown' });
    }
});
