"use strict";

/*
 * SK VIBEZ
 * Human Behavior Layer
 *
 * Responsibilities:
 * - Observe incoming room chat
 * - Reply when SK VIBEZ is mentioned
 * - Natural casual room participation
 * - Pure clear Tanglish conversation
 * - Avoid bot-to-bot conversations
 * - Avoid duplicate incoming events
 * - Avoid overlapping replies
 * - Natural reply delay
 * - Occasional idle conversation
 * - Detailed send diagnostics
 */

const MIN_REPLY_DELAY = 1000;
const MAX_REPLY_DELAY = 4000;


/*
 * Idle behavior
 */
const MIN_IDLE_INTERVAL =
  4 * 60 * 1000;

const MAX_IDLE_INTERVAL =
  9 * 60 * 1000;

const IDLE_MESSAGE_CHANCE =
  0.18;


/*
 * Incoming message deduplication
 */
const MESSAGE_DEDUPE_WINDOW =
  15000;


/*
 * State
 */
let replyInProgress = false;

let lastReply = "";

let lastActivityAt =
  Date.now();

let lastIdleMessageAt = 0;

let idleTimer = null;

let idleStarted = false;


/*
 * Recent incoming messages
 */
const recentMessages =
  new Map();


/*
 * ========================================
 * UTILITY
 * ========================================
 */

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


function randomInt(min, max) {
  return Math.floor(
    Math.random() *
      (max - min + 1)
  ) + min;
}


function randomDelay() {
  return randomInt(
    MIN_REPLY_DELAY,
    MAX_REPLY_DELAY
  );
}


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


function normalizeUsername(value) {
  return cleanText(value)
    .replace(/^@+/, "")
    .toLowerCase();
}


/*
 * ========================================
 * MESSAGE EXTRACTION
 * ========================================
 */

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

  return cleanText(
    message.message ??
    message.text ??
    message.content ??
    message.chatMessage ??
    message.body ??
    ""
  );
}


/*
 * ========================================
 * SENDER EXTRACTION
 * ========================================
 */

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
    return normalizeUsername(
      sender
    );
  }

  return normalizeUsername(
    sender.username ??
    sender.userName ??
    sender.name ??
    message.username ??
    message.userName ??
    message.senderUsername ??
    ""
  );
}


/*
 * ========================================
 * BOT DETECTION
 * ========================================
 */

function isBotMessage(message) {
  if (
    !message ||
    typeof message !== "object"
  ) {
    return false;
  }

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
    sender &&
    typeof sender === "object"
  ) {
    if (
      sender.isBot === true ||
      sender.bot === true ||
      sender.fromBot === true
    ) {
      return true;
    }
  }

  return false;
}


/*
 * ========================================
 * MESSAGE FINGERPRINT
 * ========================================
 */

function createMessageFingerprint(
  message
) {
  const username =
    getSenderUsername(message);

  const text =
    getMessageText(message)
      .toLowerCase();

  return `${username}|${text}`;
}


function cleanupRecentMessages() {
  const now =
    Date.now();

  for (
    const [
      fingerprint,
      timestamp
    ] of recentMessages.entries()
  ) {
    if (
      now - timestamp >
      MESSAGE_DEDUPE_WINDOW
    ) {
      recentMessages.delete(
        fingerprint
      );
    }
  }
}


function isDuplicateIncomingMessage(
  message
) {
  const text =
    getMessageText(message);

  if (!text) {
    return false;
  }

  cleanupRecentMessages();

  const fingerprint =
    createMessageFingerprint(
      message
    );

  const now =
    Date.now();

  const previous =
    recentMessages.get(
      fingerprint
    );

  if (
    previous &&
    now - previous <
      MESSAGE_DEDUPE_WINDOW
  ) {
    console.log(
      "[HumanBehavior] Duplicate incoming message ignored."
    );

    return true;
  }

  recentMessages.set(
    fingerprint,
    now
  );

  return false;
}


/*
 * ========================================
 * MENTION DETECTION
 * ========================================
 */

function escapeRegExp(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


function isDirectMention(
  message,
  botName = "SK VIBEZ"
) {
  const text =
    getMessageText(message);

  if (!text) {
    return false;
  }

  const normalizedText =
    text.toLowerCase();

  const normalizedBotName =
    normalizeUsername(botName);

  if (!normalizedBotName) {
    return false;
  }


  /*
   * @skvibez
   */
  const mentionPattern =
    new RegExp(
      `(^|\\s)@${escapeRegExp(
        normalizedBotName
      )}(?=\\s|$|[.,!?])`,
      "i"
    );

  if (
    mentionPattern.test(
      normalizedText
    )
  ) {
    return true;
  }


  /*
   * skvibez
   */
  const plainPattern =
    new RegExp(
      `(^|\\s)${escapeRegExp(
        normalizedBotName
      )}(?=\\s|$|[.,!?])`,
      "i"
    );

  return plainPattern.test(
    normalizedText
  );
}


/*
 * ========================================
 * REPLY DECISION
 * ========================================
 */

function shouldReplyToMessage(
  message,
  options = {}
) {
  const botName =
    options.botName ||
    "SK VIBEZ";

  const botUsername =
    options.botUsername ||
    "skvibez";

  const text =
    getMessageText(message);

  if (!text) {
    return {
      reply: false,
      reason: "empty_message"
    };
  }


  const senderUsername =
    getSenderUsername(message);


  /*
   * Never reply to itself.
   */
  if (
    senderUsername &&
    (
      senderUsername ===
        normalizeUsername(botName) ||
      senderUsername ===
        normalizeUsername(botUsername)
    )
  ) {
    return {
      reply: false,
      reason: "own_message"
    };
  }


  /*
   * Never reply to another bot.
   */
  if (
    isBotMessage(message)
  ) {
    return {
      reply: false,
      reason: "bot_message"
    };
  }


  /*
   * ======================================
   * DIRECT MENTION = HIGH PRIORITY
   * ======================================
   *
   * Anyone mentioning SK VIBEZ
   * should get a response.
   */
  if (
    isDirectMention(
      message,
      botName
    )
  ) {
    console.log(
      "[HumanBehavior] Direct SK VIBEZ mention detected from:",
      senderUsername || "unknown"
    );

    return {
      reply: true,
      reason: "direct_mention"
    };
  }


  /*
   * Normal room chat.
   *
   * Participate only occasionally.
   */
  if (
    Math.random() < 0.08
  ) {
    return {
      reply: true,
      reason:
        "casual_room_participation"
    };
  }


  return {
    reply: false,
    reason: "not_selected"
  };
}


/*
 * ========================================
 * REPLY HISTORY
 * ========================================
 */

function rememberReply(reply) {
  const value =
    cleanText(reply);

  if (!value) {
    return;
  }

  lastReply = value;
}


function isDuplicateReply(reply) {
  const value =
    cleanText(reply);

  if (
    !value ||
    !lastReply
  ) {
    return false;
  }

  return (
    value.toLowerCase() ===
    lastReply.toLowerCase()
  );
}


function chooseReply(replies) {
  if (
    !Array.isArray(replies) ||
    replies.length === 0
  ) {
    return "";
  }

  const validReplies =
    replies
      .map(cleanText)
      .filter(Boolean);

  if (
    validReplies.length === 0
  ) {
    return "";
  }

  const alternatives =
    validReplies.filter(
      (reply) =>
        !isDuplicateReply(
          reply
        )
    );

  const pool =
    alternatives.length > 0
      ? alternatives
      : validReplies;

  return pool[
    randomInt(
      0,
      pool.length - 1
    )
  ];
}


/*
 * ========================================
 * CASUAL TANGlish MESSAGES
 * ========================================
 */

const CASUAL_MESSAGES = [
  "Nalla vibe irukku inga 🎶",

  "Indha room la music mood super ah irukku 🎧",

  "Nice vibe 😄",

  "Music + good vibes ✨",

  "Chill pannitu iruken 😌",

  "Indha nerathukku oru nalla song venum 🎶",

  "Ellarum nalla vibe pannunga 😄",

  "Just enjoying the vibe 🎧",

  "Nalla poitu irukku ✨",

  "Music on, mood on 🎶"
];


function getCasualMessage() {
  return chooseReply(
    CASUAL_MESSAGES
  );
}


/*
 * ========================================
 * SAFE TYPING
 * ========================================
 *
 * No unverified Groic typing event
 * is assumed.
 */

async function safeStartTyping(
  startTyping
) {
  if (
    typeof startTyping !==
    "function"
  ) {
    return false;
  }

  try {
    await Promise.resolve(
      startTyping()
    );

    return true;

  } catch (error) {

    console.log(
      "[HumanBehavior] Typing start unavailable:",
      error?.message ||
      error
    );

    return false;
  }
}


async function safeStopTyping(
  stopTyping
) {
  if (
    typeof stopTyping !==
    "function"
  ) {
    return false;
  }

  try {
    await Promise.resolve(
      stopTyping()
    );

    return true;

  } catch (error) {

    console.log(
      "[HumanBehavior] Typing stop unavailable:",
      error?.message ||
      error
    );

    return false;
  }
}


/*
 * ========================================
 * PERFORM REPLY
 * ========================================
 */

async function performReply(
  options = {}
) {
  const {
    reply,
    sendReply,
    startTyping,
    stopTyping,
    delayMs,
    reason
  } = options;


  if (
    typeof sendReply !==
    "function"
  ) {
    console.error(
      "[HumanBehavior] sendReply function is missing."
    );

    return {
      sent: false,
      reason:
        "sendReply_function_missing"
    };
  }


  const message =
    cleanText(reply);


  if (!message) {
    console.log(
      "[HumanBehavior] Empty reply rejected."
    );

    return {
      sent: false,
      reason:
        "empty_reply"
    };
  }


  /*
   * Do not send the exact same reply
   * consecutively.
   */
  if (
    isDuplicateReply(message)
  ) {
    console.log(
      "[HumanBehavior] Duplicate reply blocked:",
      message
    );

    return {
      sent: false,
      reason:
        "duplicate_reply"
    };
  }


  /*
   * Prevent overlapping replies.
   */
  if (replyInProgress) {
    console.log(
      "[HumanBehavior] Reply already in progress."
    );

    return {
      sent: false,
      reason:
        "reply_already_in_progress"
    };
  }


  replyInProgress = true;

  let typingStarted =
    false;


  try {

    console.log(
      "[HumanBehavior] Preparing reply:",
      message
    );

    console.log(
      "[HumanBehavior] Reply reason:",
      reason || "unknown"
    );


    /*
     * Typing callback is optional.
     */
    typingStarted =
      await safeStartTyping(
        startTyping
      );


    /*
     * Natural delay.
     */
    const waitTime =
      Number.isFinite(delayMs)
        ? Math.max(
            MIN_REPLY_DELAY,
            Math.min(
              MAX_REPLY_DELAY,
              delayMs
            )
          )
        : randomDelay();


    console.log(
      "[HumanBehavior] Waiting",
      waitTime,
      "ms before sending."
    );


    await sleep(
      waitTime
    );


    /*
     * ====================================
     * SEND
     * ====================================
     */

    console.log(
      "[HumanBehavior] Calling sendReply..."
    );


    const sendResult =
      await Promise.resolve(
        sendReply(message)
      );


    /*
     * IMPORTANT:
     *
     * socket.sendChat() returns true/false.
     *
     * If false, do NOT pretend the
     * message was sent.
     */
    if (
      sendResult === false
    ) {
      console.error(
        "[HumanBehavior] sendReply returned FALSE. Message was NOT sent."
      );

      return {
        sent: false,
        reason:
          "send_reply_returned_false"
      };
    }


    /*
     * Some send functions may not
     * return anything.
     *
     * Undefined is accepted because
     * the socket emitter itself may
     * not return a useful status.
     */
    rememberReply(
      message
    );


    console.log(
      "[HumanBehavior] Reply send completed:",
      message
    );


    return {
      sent: true,
      reason: "reply_sent",
      delayMs: waitTime,
      typingStarted
    };

  } catch (error) {

    console.error(
      "[HumanBehavior] Reply send failed:",
      error?.message ||
      error
    );


    return {
      sent: false,
      reason:
        "reply_send_error",
      error
    };

  } finally {

    if (
      typingStarted
    ) {
      await safeStopTyping(
        stopTyping
      );
    }


    replyInProgress =
      false;
  }
}


/*
 * ========================================
 * HANDLE MESSAGE
 * ========================================
 */

async function handleMessage(
  message,
  options = {}
) {

  /*
   * Every room message updates
   * the activity timestamp.
   */
  lastActivityAt =
    Date.now();


  /*
   * Duplicate protection happens
   * BEFORE AI generation.
   */
  if (
    isDuplicateIncomingMessage(
      message
    )
  ) {
    return {
      handled: false,
      replied: false,
      reason:
        "duplicate_incoming_message"
    };
  }


  const decision =
    shouldReplyToMessage(
      message,
      options
    );


  if (
    !decision.reply
  ) {
    return {
      handled: false,
      replied: false,
      reason:
        decision.reason
    };
  }


  const sender =
    getSenderUsername(
      message
    );


  const text =
    getMessageText(
      message
    );


  console.log(
    "[HumanBehavior] Selected message:",
    text
  );

  console.log(
    "[HumanBehavior] Sender:",
    sender || "unknown"
  );

  console.log(
    "[HumanBehavior] Reason:",
    decision.reason
  );


  /*
   * ====================================
   * GENERATE AI REPLY
   * ====================================
   */

  let reply = "";


  if (
    typeof options.generateReply ===
    "function"
  ) {

    try {

      reply =
        await Promise.resolve(
          options.generateReply({
            message,
            reason:
              decision.reason,
            sender
          })
        );

    } catch (error) {

      console.error(
        "[HumanBehavior] Reply generation failed:",
        error?.message ||
        error
      );

      return {
        handled: true,
        replied: false,
        reason:
          "reply_generation_failed"
      };
    }

  } else if (
    decision.reason ===
    "casual_room_participation"
  ) {

    reply =
      getCasualMessage();
  }


  reply =
    cleanText(reply);


  console.log(
    "[HumanBehavior] Generated reply:",
    reply || "(empty)"
  );


  if (!reply) {
    console.log(
      "[HumanBehavior] No reply generated."
    );

    return {
      handled: true,
      replied: false,
      reason:
        "no_reply_generated"
    };
  }


  /*
   * ====================================
   * SEND REPLY
   * ====================================
   */

  const result =
    await performReply({
      reply,

      sendReply:
        options.sendReply,

      startTyping:
        options.startTyping,

      stopTyping:
        options.stopTyping,

      delayMs:
        randomDelay(),

      reason:
        decision.reason
    });


  if (
    result.sent
  ) {

    console.log(
      "[HumanBehavior] FINAL: SK VIBEZ reply sent successfully."
    );

  } else {

    console.log(
      "[HumanBehavior] FINAL: SK VIBEZ reply was NOT sent. Reason:",
      result.reason
    );
  }


  return {
    handled: true,

    replied:
      result.sent,

    reason:
      result.sent
        ? decision.reason
        : result.reason,

    result
  };
}


/*
 * ========================================
 * IDLE BEHAVIOR
 * ========================================
 */

function canSendIdleMessage() {
  const now =
    Date.now();


  const idleFor =
    now - lastActivityAt;


  const sinceLastIdleMessage =
    now - lastIdleMessageAt;


  /*
   * Room must be quiet.
   */
  if (
    idleFor <
    MIN_IDLE_INTERVAL
  ) {
    return false;
  }


  /*
   * Prevent frequent idle messages.
   */
  if (
    lastIdleMessageAt > 0 &&
    sinceLastIdleMessage <
      MIN_IDLE_INTERVAL
  ) {
    return false;
  }


  return (
    Math.random() <
    IDLE_MESSAGE_CHANCE
  );
}


async function runIdleCheck(
  options = {}
) {
  if (
    replyInProgress
  ) {
    return {
      sent: false,
      reason:
        "reply_in_progress"
    };
  }


  if (
    !canSendIdleMessage()
  ) {
    return {
      sent: false,
      reason:
        "not_idle_enough"
    };
  }


  const reply =
    getCasualMessage();


  if (!reply) {
    return {
      sent: false,
      reason:
        "no_idle_message"
    };
  }


  console.log(
    "[HumanBehavior] Idle message selected:",
    reply
  );


  const result =
    await performReply({
      reply,

      sendReply:
        options.sendReply,

      startTyping:
        options.startTyping,

      stopTyping:
        options.stopTyping,

      delayMs:
        randomDelay(),

      reason:
        "idle_behavior"
    });


  if (
    result.sent
  ) {
    lastIdleMessageAt =
      Date.now();
  }


  return result;
}


/*
 * ========================================
 * IDLE SCHEDULER
 * ========================================
 */

function scheduleNextIdleCheck(
  options = {}
) {
  if (
    !idleStarted
  ) {
    return;
  }


  const delay =
    randomInt(
      MIN_IDLE_INTERVAL,
      MAX_IDLE_INTERVAL
    );


  idleTimer =
    setTimeout(
      async () => {

        try {

          await runIdleCheck(
            options
          );

        } catch (error) {

          console.error(
            "[HumanBehavior] Idle check failed:",
            error?.message ||
            error
          );

        } finally {

          scheduleNextIdleCheck(
            options
          );
        }

      },
      delay
    );


  if (
    typeof idleTimer.unref ===
    "function"
  ) {
    idleTimer.unref();
  }
}


function startIdleBehavior(
  options = {}
) {
  if (
    idleStarted
  ) {
    return;
  }


  if (
    typeof options.sendReply !==
    "function"
  ) {
    console.log(
      "[HumanBehavior] Idle behavior not started: sendReply is missing."
    );

    return;
  }


  idleStarted = true;


  lastActivityAt =
    Date.now();


  console.log(
    "[HumanBehavior] Idle behavior started."
  );


  scheduleNextIdleCheck(
    options
  );
}


function stopIdleBehavior() {
  idleStarted = false;


  if (
    idleTimer
  ) {
    clearTimeout(
      idleTimer
    );

    idleTimer = null;
  }


  console.log(
    "[HumanBehavior] Idle behavior stopped."
  );
}


/*
 * ========================================
 * STATE
 * ========================================
 */

function getState() {
  return {
    replyInProgress,

    lastReply,

    lastActivityAt,

    lastIdleMessageAt,

    idleStarted,

    recentMessageCount:
      recentMessages.size
  };
}


function resetState() {
  lastReply = "";

  lastActivityAt =
    Date.now();

  lastIdleMessageAt =
    0;

  replyInProgress =
    false;

  recentMessages.clear();
}


/*
 * ========================================
 * EXPORTS
 * ========================================
 */

module.exports = {
  sleep,
  randomInt,
  randomDelay,

  getMessageText,
  getSenderUsername,
  isBotMessage,

  createMessageFingerprint,
  isDuplicateIncomingMessage,

  isDirectMention,
  shouldReplyToMessage,

  chooseReply,
  getCasualMessage,

  safeStartTyping,
  safeStopTyping,

  performReply,
  handleMessage,

  runIdleCheck,
  startIdleBehavior,
  stopIdleBehavior,

  getState,
  resetState
};
