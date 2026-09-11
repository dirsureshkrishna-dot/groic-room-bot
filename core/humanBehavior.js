"use strict";

/*
 * ============================================================
 * SK VIBEZ - HUMAN CHAT BEHAVIOR
 * ============================================================
 *
 * Purpose:
 *
 * 1. SK VIBEZ mention செய்தால் ALWAYS try to reply.
 * 2. Room chat-ஐ observe செய்து context புரிந்து கொள்ளும்.
 * 3. சில நேரங்களில் தானாக conversation-ல் கலந்து கொள்ளும்.
 * 4. ஒரே user-ஐ தொடர்ந்து reply செய்து spam செய்யாது.
 * 5. Natural conversation gaps இருக்கும்.
 * 6. AI reply generator-க்கு message + sender + reason அனுப்பும்.
 * 7. Bot messages-ஐ ignore செய்யும்.
 * 8. Duplicate messages/replies-ஐ prevent செய்யும்.
 * 9. Idle நேரத்திலும் சில நேரங்களில் room vibe message அனுப்பும்.
 *
 * NOTE:
 * இது human போல நடிப்பதற்காக அல்ல.
 * SK VIBEZ ஒரு bot என்று கேட்டால் honest ஆக இருக்க வேண்டும்.
 * ============================================================
 */


/* ============================================================
 * CONFIG
 * ============================================================ */

const MIN_REPLY_DELAY =
  1200;

const MAX_REPLY_DELAY =
  4200;


/*
 * Direct mention:
 *
 * Example:
 * skvibez hi
 * skvibez saptiya
 * @skvibez enna panra
 *
 * Direct mentionக்கு cooldown குறைவு.
 */
const DIRECT_REPLY_COOLDOWN =
  3000;


/*
 * Same userக்கு repeated casual replies
 * வராமல் இருக்க.
 */
const PER_USER_REPLY_COOLDOWN =
  45000;


/*
 * General room conversation:
 *
 * Bot அடிக்கடி பேசக்கூடாது.
 */
const GLOBAL_REPLY_COOLDOWN =
  25000;


/*
 * Normal room messages-ல் தானாக கலந்து
 * கொள்ளும் probability.
 *
 * 0.10 = 10%
 */
const CASUAL_REPLY_CHANCE =
  0.10;


/*
 * Same room userக்கு autonomous reply
 * செய்யும் minimum gap.
 */
const AUTONOMOUS_USER_COOLDOWN =
  90000;


/*
 * Duplicate incoming message window.
 */
const DUPLICATE_MESSAGE_WINDOW =
  20000;


/*
 * Idle behavior.
 */
const IDLE_MIN_QUIET =
  4 * 60 * 1000;

const IDLE_MAX_CHECK =
  9 * 60 * 1000;

const IDLE_REPLY_CHANCE =
  0.18;


/*
 * Recent conversation memory.
 *
 * இது room conversation-ஐ முழுமையாக சேமிக்காது.
 * Short-term context மட்டும் வைத்திருக்கும்.
 */
const MAX_CONTEXT_MESSAGES =
  25;


/* ============================================================
 * STATE
 * ============================================================ */

let replyInProgress =
  false;

let lastReplyAt =
  0;

let lastActivityAt =
  Date.now();

let lastIdleMessageAt =
  0;

let idleTimer =
  null;

let idleStarted =
  false;


/*
 * Incoming message dedupe.
 */
const recentMessages =
  new Map();


/*
 * Per-user last reply time.
 */
const lastReplyByUser =
  new Map();


/*
 * Short room conversation context.
 */
const conversationContext =
  [];


/* ============================================================
 * TEXT HELPERS
 * ============================================================ */

function cleanText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


/* ============================================================
 * EXTRACT MESSAGE TEXT
 * ============================================================ */

function getMessageText(message) {
  if (
    typeof message === "string"
  ) {
    return cleanText(message);
  }

  if (
    !message ||
    typeof message !== "object"
  ) {
    return "";
  }


  /*
   * Standard Groic chat payload.
   */
  if (
    typeof message.message === "string"
  ) {
    return cleanText(
      message.message
    );
  }


  if (
    typeof message.text === "string"
  ) {
    return cleanText(
      message.text
    );
  }


  if (
    typeof message.content === "string"
  ) {
    return cleanText(
      message.content
    );
  }


  if (
    typeof message.chatMessage === "string"
  ) {
    return cleanText(
      message.chatMessage
    );
  }


  if (
    typeof message.body === "string"
  ) {
    return cleanText(
      message.body
    );
  }


  return "";
}


/* ============================================================
 * EXTRACT SENDER USERNAME / NAME
 * ============================================================ */

function getSenderUsername(message) {
  if (
    !message ||
    typeof message !== "object"
  ) {
    return "";
  }


  const sender =
    message.user ??
    message.sender ??
    message.author ??
    message.profile ??
    {};


  if (
    typeof sender === "string"
  ) {
    return cleanText(sender);
  }


  return cleanText(
    sender?.username ??
    sender?.userName ??
    sender?.name ??
    message.username ??
    message.userName ??
    message.senderUsername ??
    ""
  );
}


/* ============================================================
 * EXTRACT SENDER ID
 * ============================================================ */

function getSenderId(message) {
  if (
    !message ||
    typeof message !== "object"
  ) {
    return "";
  }


  const sender =
    message.user ??
    message.sender ??
    message.author ??
    message.profile ??
    {};


  return cleanText(
    sender?.uid ??
    sender?.userId ??
    sender?.id ??
    message.userId ??
    message.uid ??
    message.senderId ??
    getSenderUsername(message)
  );
}


/* ============================================================
 * BOT DETECTION
 * ============================================================ */

function isBotMessage(message) {
  if (
    !message ||
    typeof message !== "object"
  ) {
    return false;
  }


  /*
   * Explicit bot flags.
   */
  if (
    message.isBot === true ||
    message.bot === true ||
    message.fromBot === true
  ) {
    return true;
  }


  const sender =
    message.user ??
    message.sender ??
    message.author ??
    message.profile ??
    {};


  if (
    sender?.isBot === true ||
    sender?.bot === true ||
    sender?.fromBot === true
  ) {
    return true;
  }


  /*
   * Known bot usernames in this room.
   *
   * IMPORTANT:
   * We do not treat normal users as bots.
   */
  const username =
    getSenderUsername(
      message
    ).toLowerCase();


  const knownBots = new Set([
    "skvibez",
    "groicai",
    "groic_explore",
    "groic_music"
  ]);


  if (
    knownBots.has(username)
  ) {
    return true;
  }


  return false;
}


/* ============================================================
 * DIRECT MENTION DETECTION
 * ============================================================ */

function isDirectMention(
  message,
  botName = "SK VIBEZ",
  botUsername = "skvibez"
) {
  const text =
    getMessageText(
      message
    );


  if (!text) {
    return false;
  }


  const normalized =
    text
      .toLowerCase()
      .trim();


  const name =
    cleanText(
      botName
    )
      .toLowerCase();


  const username =
    cleanText(
      botUsername
    )
      .toLowerCase();


  /*
   * @skvibez
   */
  if (
    username &&
    normalized.includes(
      `@${username}`
    )
  ) {
    return true;
  }


  /*
   * skvibez
   */
  if (
    username &&
    new RegExp(
      `(^|\\s)${escapeRegExp(username)}(\\s|$|[?!.,])`,
      "i"
    ).test(text)
  ) {
    return true;
  }


  /*
   * SK VIBEZ
   */
  if (
    name &&
    new RegExp(
      `(^|\\s)${escapeRegExp(name)}(\\s|$|[?!.,])`,
      "i"
    ).test(text)
  ) {
    return true;
  }


  return false;
}


/* ============================================================
 * ESCAPE REGEX
 * ============================================================ */

function escapeRegExp(value) {
  return String(value || "")
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


/* ============================================================
 * DUPLICATE MESSAGE KEY
 * ============================================================ */

function getMessageKey(
  message
) {
  const sender =
    getSenderUsername(
      message
    )
      .toLowerCase();

  const text =
    getMessageText(
      message
    )
      .toLowerCase();

  return `${sender}|${text}`;
}


/* ============================================================
 * DUPLICATE CHECK
 * ============================================================ */

function isDuplicateIncoming(
  message
) {
  const key =
    getMessageKey(
      message
    );


  if (!key || key === "|") {
    return true;
  }


  const now =
    Date.now();


  const previous =
    recentMessages.get(
      key
    );


  if (
    previous &&
    now - previous <
      DUPLICATE_MESSAGE_WINDOW
  ) {
    return true;
  }


  recentMessages.set(
    key,
    now
  );


  /*
   * Cleanup old entries.
   */
  for (
    const [
      storedKey,
      timestamp
    ] of recentMessages
  ) {
    if (
      now - timestamp >
      DUPLICATE_MESSAGE_WINDOW
    ) {
      recentMessages.delete(
        storedKey
      );
    }
  }


  return false;
}


/* ============================================================
 * CONVERSATION CONTEXT
 * ============================================================ */

function rememberConversation(
  message
) {
  const text =
    getMessageText(
      message
    );

  const sender =
    getSenderUsername(
      message
    );


  if (!text) {
    return;
  }


  conversationContext.push({
    sender:
      sender || "someone",

    message:
      text,

    timestamp:
      Date.now()
  });


  while (
    conversationContext.length >
    MAX_CONTEXT_MESSAGES
  ) {
    conversationContext.shift();
  }
}


/* ============================================================
 * GET CONTEXT
 * ============================================================ */

function getConversationContext() {
  return conversationContext
    .slice(-10)
    .map(
      (item) =>
        `${item.sender}: ${item.message}`
    )
    .join("\n");
}


/* ============================================================
 * REPLY DECISION
 * ============================================================ */

function shouldReply({
  message,
  botName,
  botUsername
}) {
  const text =
    getMessageText(
      message
    );


  if (!text) {
    return {
      reply: false,
      reason: "empty_message"
    };
  }


  /*
   * Never reply to our own/bot messages.
   */
  if (
    isBotMessage(
      message
    )
  ) {
    return {
      reply: false,
      reason: "bot_message"
    };
  }


  /*
   * Direct mention ALWAYS gets priority.
   */
  if (
    isDirectMention(
      message,
      botName,
      botUsername
    )
  ) {
    return {
      reply: true,
      reason: "direct_mention"
    };
  }


  /*
   * Commands should not trigger random
   * conversation replies.
   */
  const normalized =
    text
      .toLowerCase()
      .trim();


  if (
    normalized.startsWith("!") ||
    normalized.startsWith("/")
  ) {
    return {
      reply: false,
      reason: "command"
    };
  }


  /*
   * Global cooldown for casual participation.
   */
  const now =
    Date.now();


  if (
    now - lastReplyAt <
    GLOBAL_REPLY_COOLDOWN
  ) {
    return {
      reply: false,
      reason: "global_cooldown"
    };
  }


  /*
   * Per-user cooldown.
   */
  const sender =
    getSenderUsername(
      message
    ).toLowerCase();


  const lastUserReply =
    lastReplyByUser.get(
      sender
    ) || 0;


  if (
    sender &&
    now - lastUserReply <
      AUTONOMOUS_USER_COOLDOWN
  ) {
    return {
      reply: false,
      reason: "user_cooldown"
    };
  }


  /*
   * Random natural participation.
   */
  if (
    Math.random() <
    CASUAL_REPLY_CHANCE
  ) {
    return {
      reply: true,
      reason: "casual_room_chat"
    };
  }


  return {
    reply: false,
    reason: "not_selected"
  };
}


/* ============================================================
 * HUMAN-LIKE DELAY
 * ============================================================ */

function randomDelay(
  min,
  max
) {
  return (
    Math.floor(
      Math.random() *
        (max - min + 1)
    ) + min
  );
}


function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}


/* ============================================================
 * PERFORM REPLY
 * ============================================================ */

async function performReply({
  reply,
  sender,
  reason,
  sendReply,
  startTyping,
  stopTyping
}) {
  const text =
    cleanText(
      reply
    );


  if (!text) {
    return false;
  }


  if (
    typeof sendReply !==
    "function"
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] sendReply is missing."
    );

    return false;
  }


  /*
   * Prevent overlapping replies.
   */
  if (
    replyInProgress
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Reply already in progress."
    );

    return false;
  }


  /*
   * Prevent exact duplicate reply.
   */
  if (
    text ===
    lastSentReply
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Duplicate reply skipped."
    );

    return false;
  }


  replyInProgress =
    true;


  try {

    const delay =
      randomDelay(
        MIN_REPLY_DELAY,
        MAX_REPLY_DELAY
      );


    console.log(
      `[SKVIBEZ HumanBehavior] Waiting ${delay}ms before reply (${reason}).`
    );


    /*
     * Typing adapter.
     *
     * Currently undefined from socket.js,
     * so this safely does nothing.
     */
    if (
      typeof startTyping ===
      "function"
    ) {
      try {
        await startTyping(
          sender
        );
      } catch (error) {
        console.log(
          "[SKVIBEZ HumanBehavior] Typing start ignored:",
          error?.message ||
          error
        );
      }
    }


    await sleep(
      delay
    );


    const result =
      await sendReply(
        text
      );


    if (
      result === false
    ) {
      console.log(
        "[SKVIBEZ HumanBehavior] Reply send returned false."
      );

      return false;
    }


    lastSentReply =
      text;

    lastReplyAt =
      Date.now();


    if (sender) {
      lastReplyByUser.set(
        sender.toLowerCase(),
        Date.now()
      );
    }


    console.log(
      "[SKVIBEZ HumanBehavior] Reply sent:",
      text
    );


    return true;

  } finally {

    if (
      typeof stopTyping ===
      "function"
    ) {
      try {
        await stopTyping(
          sender
        );
      } catch (error) {
        console.log(
          "[SKVIBEZ HumanBehavior] Typing stop ignored:",
          error?.message ||
          error
        );
      }
    }


    replyInProgress =
      false;
  }
}


/*
 * Last sent reply.
 */
let lastSentReply =
  "";


/* ============================================================
 * HANDLE MESSAGE
 * ============================================================ */

async function handleMessage(
  message,
  options = {}
) {
  const {
    botName =
      "SK VIBEZ",

    botUsername =
      "skvibez",

    generateReply,

    sendReply,

    startTyping,

    stopTyping
  } = options;


  /*
   * Update room activity.
   */
  lastActivityAt =
    Date.now();


  /*
   * Ignore empty messages.
   */
  const text =
    getMessageText(
      message
    );


  if (!text) {
    return {
      replied: false,
      reason: "empty_message"
    };
  }


  /*
   * Ignore duplicate incoming event.
   */
  if (
    isDuplicateIncoming(
      message
    )
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Duplicate incoming message ignored."
    );

    return {
      replied: false,
      reason: "duplicate_message"
    };
  }


  /*
   * Ignore bots.
   */
  if (
    isBotMessage(
      message
    )
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Ignored bot message."
    );

    return {
      replied: false,
      reason: "bot_message"
    };
  }


  /*
   * Remember room conversation.
   */
  rememberConversation(
    message
  );


  const sender =
    getSenderUsername(
      message
    ) ||
    "someone";


  const decision =
    shouldReply({
      message,
      botName,
      botUsername
    });


  if (!decision.reply) {

    /*
     * Debug only.
     */
    console.log(
      `[SKVIBEZ HumanBehavior] Ignored message (${decision.reason}) from ${sender}: ${text}`
    );

    return {
      replied: false,
      reason:
        decision.reason
    };
  }


  /*
   * If another reply is already being sent,
   * don't create overlapping conversation.
   */
  if (
    replyInProgress
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Another reply is currently being sent."
    );

    return {
      replied: false,
      reason: "reply_in_progress"
    };
  }


  /*
   * AI generator required.
   */
  if (
    typeof generateReply !==
    "function"
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] generateReply is missing."
    );

    return {
      replied: false,
      reason: "generator_missing"
    };
  }


  try {

    console.log(
      `[SKVIBEZ HumanBehavior] Generating ${decision.reason} reply for ${sender}: ${text}`
    );


    /*
     * IMPORTANT:
     *
     * Send complete context to chatBehavior.
     *
     * sender
     * message
     * reason
     * room context
     */
    const reply =
      await generateReply({
        message,
        reason:
          decision.reason,
        sender,
        conversationContext:
          getConversationContext()
      });


    const cleanedReply =
      cleanText(
        reply
      );


    if (!cleanedReply) {
      console.log(
        "[SKVIBEZ HumanBehavior] AI returned empty reply."
      );

      return {
        replied: false,
        reason:
          "empty_ai_reply"
      };
    }


    const sent =
      await performReply({
        reply:
          cleanedReply,

        sender,

        reason:
          decision.reason,

        sendReply,

        startTyping,

        stopTyping
      });


    return {
      replied:
        sent,

      reason:
        decision.reason
    };

  } catch (error) {

    console.error(
      "[SKVIBEZ HumanBehavior] Reply generation failed:",
      error?.message ||
      error
    );


    return {
      replied: false,
      reason:
        "reply_error"
    };
  }
}


/* ============================================================
 * IDLE BEHAVIOR
 * ============================================================ */

function startIdleBehavior(
  options = {}
) {
  const {
    sendReply,
    startTyping,
    stopTyping
  } = options;


  stopIdleBehavior();


  idleStarted =
    true;


  console.log(
    "[SKVIBEZ HumanBehavior] Idle behavior started."
  );


  scheduleIdleCheck({
    sendReply,
    startTyping,
    stopTyping
  });
}


/* ============================================================
 * SCHEDULE IDLE CHECK
 * ============================================================ */

function scheduleIdleCheck(
  options
) {
  if (!idleStarted) {
    return;
  }


  if (idleTimer) {
    clearTimeout(
      idleTimer
    );
  }


  const delay =
    randomDelay(
      IDLE_MIN_QUIET,
      IDLE_MAX_CHECK
    );


  idleTimer =
    setTimeout(
      async () => {

        idleTimer =
          null;


        if (!idleStarted) {
          return;
        }


        await performIdleCheck(
          options
        );


        scheduleIdleCheck(
          options
        );

      },
      delay
    );


  /*
   * Railway/Node process should not
   * stay alive only because of idle timer.
   */
  if (
    typeof idleTimer.unref ===
    "function"
  ) {
    idleTimer.unref();
  }
}


/* ============================================================
 * PERFORM IDLE CHECK
 * ============================================================ */

async function performIdleCheck(
  options
) {
  const {
    sendReply,
    startTyping,
    stopTyping
  } = options;


  const now =
    Date.now();


  /*
   * Room had activity recently.
   */
  if (
    now - lastActivityAt <
    IDLE_MIN_QUIET
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Room is active. Idle message skipped."
    );

    return;
  }


  /*
   * Don't idle-chat too frequently.
   */
  if (
    now - lastIdleMessageAt <
    8 * 60 * 1000
  ) {
    return;
  }


  /*
   * Random chance.
   */
  if (
    Math.random() >
    IDLE_REPLY_CHANCE
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Idle check: staying quiet."
    );

    return;
  }


  const idleMessages = [
    "Inga semma silent ah irukku 😄",

    "Oru nalla song oda vibe pannalam 🎶",

    "Room la chill mood ah irukku 😌",

    "Yaaravadhu oru super song suggest pannunga 🎧",

    "Music on pannitu summa vibe pannitu iruken 😄",

    "Indha nerathukku melody vibe super ah irukum 🎶",

    "Ellarum enna pannitu irukeenga 😄",

    "Room silent ah irundhaalum vibe irukku 🎧"
  ];


  const message =
    idleMessages[
      Math.floor(
        Math.random() *
        idleMessages.length
      )
    ];


  lastIdleMessageAt =
    now;


  lastActivityAt =
    now;


  await performReply({
    reply:
      message,

    sender:
      "",

    reason:
      "idle_room_chat",

    sendReply,

    startTyping,

    stopTyping
  });
}


/* ============================================================
 * STOP IDLE BEHAVIOR
 * ============================================================ */

function stopIdleBehavior() {
  idleStarted =
    false;


  if (idleTimer) {
    clearTimeout(
      idleTimer
    );

    idleTimer =
      null;
  }


  console.log(
    "[SKVIBEZ HumanBehavior] Idle behavior stopped."
  );
}


/* ============================================================
 * CLEAR CONTEXT
 * ============================================================ */

function clearConversationContext() {
  conversationContext.length =
    0;

  recentMessages.clear();
  lastReplyByUser.clear();

  lastSentReply =
    "";

  console.log(
    "[SKVIBEZ HumanBehavior] Conversation context cleared."
  );
}


/* ============================================================
 * EXPORTS
 * ============================================================ */

module.exports = {
  handleMessage,

  startIdleBehavior,

  stopIdleBehavior,

  clearConversationContext,

  getMessageText,

  getSenderUsername,

  isBotMessage,

  isDirectMention
};
