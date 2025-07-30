const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// 🔧 الإعدادات
const CONFIG = {
  TRUSTED_NUMBERS: [
    '201113780047',   // الرقم الثابت
    '201101407889',   // حماده
    '201103766772',   // المساوي
    '201129913740',   // حامد
    '201103766776',   // مصطفي
    '201103121900',   // مريم
    '201119975840',   // رحمه
    '201129971358',   // لوليتا
    '201020620617',   // شيماء
    '201101665205',   // عادل
    '201119975830',   // عبدالرحمن
    '201119975869',   // زيكا
    '201111791786',   // طارق
    '201111792414',   // ايات
    '201119975820'    // ايات
  ],
  STAFF_GROUP_NAME: 'خاص بموظفين Eyana',
  EXCLUDED_GROUP_NAME: '🧳🚢(جروب عام )إيانا تورز سوهاج🧳✈️',
  AUTO_REPLY_DELAY: 5 * 60 * 1000,
  AGENT_REPLY_WINDOW: 10 * 60 * 1000,
  RESPONSES: {
    DATA_CORRECTION: `📌 برجاء مراجعة البيانات التالية بدقة:\n- الاسم الكامل\n- تاريخ الرحلة\n- خط السير\n⚠️ سيتم تحملكم المسؤولية عند وجود أخطاء`,
    AUTO_REPLY: `👌 رسالتك وصلت، وفي موظف هيتابع معاك حالًا إن شاء الله ✨`,
    FOLLOW_UP: `⏰ لم يتم الرد حتى الآن.\nسيتم المتابعة قريبًا من أحد ممثلي الخدمة.`,
    COMPLETION_ACK: `شكراً لك، تم إيقاف المتابعة. يمكنك التواصل معنا مجدداً عند الحاجة.`,
    STAFF_ALERT: `🚨 تنبيه تأخر رد\n\n🔹 اسم الجروب: {GROUP_NAME}\n\n📝 الرسالة: "{MESSAGE}"\n\n⏱ المدة: أكثر من 5 دقائق\n\n👉 الرجاء المتابعة العاجلة`
  },
  COMPLETION_KEYWORDS: ['تمام', 'شكرا', 'خلص']
};

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

const messageTimers = new Map();
const lastAgentReply = new Map();
const pendingQuestions = new Set();
const likedFirstMessages = new Set();
const staffGroupCache = {};

const isTrustedAgent = (number) => CONFIG.TRUSTED_NUMBERS.includes(number);
const isEYANAGroup = (groupName) => /إيانا|ايانا|eyana/i.test(groupName);
const shouldProcessGroup = (chat) =>
  chat.isGroup &&
  isEYANAGroup(chat.name) &&
  chat.name !== CONFIG.EXCLUDED_GROUP_NAME;

async function sendStaffAlert(groupName, messageText) {
  try {
    if (!staffGroupCache.id) {
      const chats = await client.getChats();
      staffGroupCache.id = chats.find(c =>
        c.isGroup && c.name === CONFIG.STAFF_GROUP_NAME
      )?.id._serialized;
    }

    if (staffGroupCache.id) {
      const staffGroup = await client.getChatById(staffGroupCache.id);
      const alertMessage = CONFIG.RESPONSES.STAFF_ALERT
        .replace('{GROUP_NAME}', groupName)
        .replace('{MESSAGE}', messageText.substring(0, 100));
      await staffGroup.sendMessage(alertMessage);
      console.log(`تم إرسال تنبيه للموظفين عن تأخر الرد في جروب ${groupName}`);
    } else {
      console.error('⚠️ لم يتم العثور على جروب الموظفين');
    }
  } catch (error) {
    console.error('فشل في إرسال تنبيه الموظفين:', error);
  }
}

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ البوت جاهز للعمل!');
});

client.on('message_create', async msg => {
  try {
    if (msg.fromMe || msg.isStatus) return;

    const chat = await msg.getChat();
    if (!shouldProcessGroup(chat)) return;

    const contact = await msg.getContact();
    const senderNumber = contact.id.user;
    const messageText = msg.body.trim().toLowerCase();
    const chatId = chat.id._serialized;

    // 🛑 تجاهل أول رسالة من موظف موثوق
    if (isTrustedAgent(senderNumber)) {
      const messages = await chat.fetchMessages({ limit: 2 });
      const isFirstMessage = messages.length <= 1;
      if (isFirstMessage) {
        console.log('⛔️ تم تجاهل أول رسالة من موظف موثوق');
        return;
      }
    }

    if (messageText.startsWith('0*')) {
      await chat.sendMessage(CONFIG.RESPONSES.DATA_CORRECTION);
      return;
    }

    if (isTrustedAgent(senderNumber)) {
      lastAgentReply.set(chatId, Date.now());
      pendingQuestions.delete(chatId);
      if (!likedFirstMessages.has(chatId)) {
        try {
          await msg.react('👍');
          likedFirstMessages.add(chatId);
        } catch (error) {
          console.error('فشل في عمل لايك:', error.message);
        }
      }
      return;
    }

    if (CONFIG.COMPLETION_KEYWORDS.some(keyword => messageText.includes(keyword))) {
      if (messageTimers.has(chatId)) {
        const { timeout } = messageTimers.get(chatId);
        clearTimeout(timeout);
        messageTimers.delete(chatId);
        pendingQuestions.delete(chatId);
        await chat.sendMessage(CONFIG.RESPONSES.COMPLETION_ACK);
      }
      return;
    }

    const lastReplyTime = lastAgentReply.get(chatId) || 0;
    if (Date.now() - lastReplyTime < CONFIG.AGENT_REPLY_WINDOW) return;
    if (messageTimers.has(chatId) || pendingQuestions.has(chatId)) return;

    pendingQuestions.add(chatId);
    const botMessage = await chat.sendMessage(CONFIG.RESPONSES.AUTO_REPLY);

    const timeout = setTimeout(async () => {
      await chat.sendMessage(CONFIG.RESPONSES.FOLLOW_UP);
      await sendStaffAlert(chat.name, msg.body.trim());
      messageTimers.delete(chatId);
      pendingQuestions.delete(chatId);
    }, CONFIG.AUTO_REPLY_DELAY);

    messageTimers.set(chatId, { botMessage, timeout });
  } catch (error) {
    console.error('حدث خطأ:', error);
  }
});

client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    if (!shouldProcessGroup(chat)) return;

    const contact = await msg.getContact();
    const senderNumber = contact.id.user;
    const chatId = chat.id._serialized;

    if (isTrustedAgent(senderNumber)) {
      lastAgentReply.set(chatId, Date.now());
      if (messageTimers.has(chatId)) {
        const { timeout } = messageTimers.get(chatId);
        clearTimeout(timeout);
        messageTimers.delete(chatId);
        pendingQuestions.delete(chatId);
      }
    }
  } catch (error) {
    console.error('حدث خطأ:', error);
  }
});

client.on('auth_failure', () => {
  console.error('❌ فشل المصادقة');
});

client.on('disconnected', (reason) => {
  console.error('❌ تم قطع الاتصال:', reason);
  likedFirstMessages.clear();
  staffGroupCache.id = null;
});

client.initialize().catch(err => {
  console.error('❌ فشل التشغيل:', err);
});
