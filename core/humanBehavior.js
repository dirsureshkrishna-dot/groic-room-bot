"use strict";

/*
 * SK VIBEZ
 * Human Behavior Layer
 *
 * Responsibilities:
 * - Watch room chat
 * - Reply whenever SK VIBEZ is mentioned
 * - Understand who is talking
 * - Avoid replying to bots
 * - Avoid duplicate messages
 * - Avoid repeated replies
 * - Natural 1–4 second reply delay
 * - Limit repeated replies to the same person
 * - Occasionally participate in normal room conversation
 * - Occasionally speak when the room is quiet
 * - Pure, clear Tanglish style
 *
 * NOTE:
 * Welcome message is handled elsewhere.
 * This file does NOT change the existing welcome message.
 */


/* -------------------------------------------------------
 * BOT IDENTITY
 * ----------------------------------------------------- */

const BOT_NAME = "SK VIBEZ";
const BOT_USERNAME = "skvibez";


/* -------------------------------------------------------
 * NATURAL REPLY TIMING
 * ----------------------------------------------------- */

const MIN_REPLY_DELAY = 1000;
const MAX_REPLY_DELAY = 4000;


/* -------------------------------------------------------
 * IDLE BEHAVIOR
 * ----------------------------------------------------- */

const MIN_IDLE_INTERVAL = 4 * 60 * 1000;
const MAX_IDLE_INTERVAL = 9 * 60 * 1000;

const IDLE_MESSAGE_CHANCE = 0.15;


/* -------------------------------------------------------
 * NORMAL ROOM PARTICIPATION
 *
 * SK VIBEZ should NOT reply to every message.
 * ----------------------------------------------------- */

const NORMAL_CHAT_REPLY_CHANCE = 0.06;


/* -------------------------------------------------------
 * SAME USER REPLY PROTECTION
 *
 * Prevent the bot from continuously replying to
 * the same person.
 * ----------------------------------------------------- */

const SAME_USER_COOLDOWN = 25 * 1000;

const userReplyHistory = new Map();


/* -------------------------------------------------------
 * GENERAL STATE
 * ----------------------------------------------------- */

let replyInProgress = false;

let lastReply = "";

let lastActivityAt = Date.now();

let lastIdleMessageAt = 0;

let idleTimer = null;

let idleStarted = false;


/* -------------------------------------------------------
 * INCOMING MESSAGE DEDUPLICATION
 * ----------------------------------------------------- */

const MESSAGE_DEDUPE_WINDOW = 15000;

const recentMessages = new Map();


/* -------------------------------------------------------
 * UTILITY
 * ----------------------------------------------------- */

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


function randomInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
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


function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


/* -------------------------------------------------------
 * MESSAGE EXTRACTION
 * ----------------------------------------------------- */

function getMessageText(message) {
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

  if (typeof sender === "string") {
    return normalizeUsername(sender);
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


/* -------------------------------------------------------
 * BOT DETECTION
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * MESSAGE FINGERPRINT
 * ----------------------------------------------------- */

function createMessageFingerprint(message) {
  const username =
    getSenderUsername(message);

  const text =
    getMessageText(message)
      .toLowerCase();

  return `${username}|${text}`;
}


/* -------------------------------------------------------
 * CLEAN OLD MESSAGE FINGERPRINTS
 * ----------------------------------------------------- */

function cleanupRecentMessages() {
  const now = Date.now();

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


/* -------------------------------------------------------
 * DUPLICATE MESSAGE CHECK
 * ----------------------------------------------------- */

function isDuplicateIncomingMessage(message) {
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

  const previous =
    recentMessages.get(
      fingerprint
    );

  const now = Date.now();

  if (
    previous &&
    now - previous <
      MESSAGE_DEDUPE_WINDOW
  ) {
    return true;
  }

  recentMessages.set(
    fingerprint,
    now
  );

  return false;
}


/* -------------------------------------------------------
 * SK VIBEZ MENTION DETECTION
 *
 * These all count as a direct mention:
 *
 * @skvibez
 * skvibez
 * @SK VIBEZ
 * SK VIBEZ
 * ----------------------------------------------------- */

function isDirectMention(
  message,
  botName = BOT_NAME,
  botUsername = BOT_USERNAME
) {
  const text =
    getMessageText(message);

  if (!text) {
    return false;
  }

  const normalizedText =
    text.toLowerCase();

  const names = [
    botName,
    botUsername,
    "sk vibe",
    "skvibez"
  ];

  for (const name of names) {
    const normalizedName =
      normalizeUsername(name);

    if (!normalizedName) {
      continue;
    }

    /*
     * Username style:
     *
     * @skvibez
     */
    const usernamePattern =
      new RegExp(
        `(^|\\s)@${escapeRegExp(
          normalizedName
        )}(?=\\s|$|[.,!?])`,
        "i"
      );

    if (
      usernamePattern.test(
        normalizedText
      )
    ) {
      return true;
    }

    /*
     * Plain name:
     *
     * skvibez
     */
    const plainPattern =
      new RegExp(
        `(^|\\s)${escapeRegExp(
          normalizedName
        )}(?=\\s|$|[.,!?])`,
        "i"
      );

    if (
      plainPattern.test(
        normalizedText
      )
    ) {
      return true;
    }
  }

  /*
   * Special handling for:
   *
   * SK VIBEZ
   */
  if (
    /\bsk\s*vibez\b/i.test(
      text
    )
  ) {
    return true;
  }

  return false;
}


/* -------------------------------------------------------
 * SAME USER COOLDOWN
 * ----------------------------------------------------- */

function canReplyToUser(username) {
  const user =
    normalizeUsername(username);

  if (!user) {
    return true;
  }

  const lastTime =
    userReplyHistory.get(user);

  if (!lastTime) {
    return true;
  }

  return (
    Date.now() - lastTime >=
    SAME_USER_COOLDOWN
  );
}


function rememberUserReply(username) {
  const user =
    normalizeUsername(username);

  if (!user) {
    return;
  }

  userReplyHistory.set(
    user,
    Date.now()
  );
}


function cleanupUserReplyHistory() {
  const now = Date.now();

  for (
    const [
      username,
      timestamp
    ] of userReplyHistory.entries()
  ) {
    if (
      now - timestamp >
      SAME_USER_COOLDOWN * 4
    ) {
      userReplyHistory.delete(
        username
      );
    }
  }
}


/* -------------------------------------------------------
 * DECIDE WHETHER TO REPLY
 * ----------------------------------------------------- */

function shouldReplyToMessage(
  message,
  options = {}
) {
  const botName =
    options.botName ||
    BOT_NAME;

  const botUsername =
    options.botUsername ||
    BOT_USERNAME;

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
   * Ignore own messages.
   */
  if (
    senderUsername &&
    (
      senderUsername ===
        normalizeUsername(botName) ||
      senderUsername ===
        normalizeUsername(botUsername) ||
      senderUsername ===
        normalizeUsername("skvibez")
    )
  ) {
    return {
      reply: false,
      reason: "own_message"
    };
  }


  /*
   * Ignore other bots.
   */
  if (
    isBotMessage(message)
  ) {
    return {
      reply: false,
      reason: "bot_message"
    };
  }


  cleanupUserReplyHistory();


  /*
   * -----------------------------------------------------
   * DIRECT MENTION = PRIORITY
   * -----------------------------------------------------
   *
   * Whoever mentions SK VIBEZ gets a reply.
   */
  if (
    isDirectMention(
      message,
      botName,
      botUsername
    )
  ) {
    /*
     * Even with the same-user cooldown,
     * a direct mention is important.
     *
     * We allow the reply if the user has waited
     * long enough.
     */
    if (
      canReplyToUser(
        senderUsername
      )
    ) {
      return {
        reply: true,
        reason: "direct_mention"
      };
    }

    return {
      reply: false,
      reason:
        "same_user_cooldown"
    };
  }


  /*
   * -----------------------------------------------------
   * NORMAL ROOM CHAT
   * -----------------------------------------------------
   *
   * Only occasionally participate.
   */
  if (
    Math.random() <
    NORMAL_CHAT_REPLY_CHANCE
  ) {
    if (
      canReplyToUser(
        senderUsername
      )
    ) {
      return {
        reply: true,
        reason:
          "casual_room_participation"
      };
    }
  }


  return {
    reply: false,
    reason: "not_selected"
  };
}


/* -------------------------------------------------------
 * REPLY HISTORY
 * ----------------------------------------------------- */

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


/* -------------------------------------------------------
 * REPLY SELECTION
 * ----------------------------------------------------- */

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
        !isDuplicateReply(reply)
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


/* -------------------------------------------------------
 * PURE TANGlish CASUAL MESSAGES
 *
 * Tamil meaning should be easy to understand.
 * Tamil Unicode is intentionally avoided.
 * ----------------------------------------------------- */

const CASUAL_MESSAGES = [
  "Inga vibe nalla irukku 😄",

  "Music oda chill pannitu iruken 🎶",

  "Innaiku room semma active ah irukku 😄",

  "Oru nalla song potta vibe innum super ah irukkum 🎧",

  "Ellarum nalla vibe pannitu irukkinga pola 😄",

  "Music kekka mood semma ah irukku 🎶",

  "Chill ah iruppom... music enjoy pannuvom 😌",

  "Inga pesura vibe nalla irukku ✨",

  "Oru happy song venum pola irukku 😄🎶",

  "Nalla music irundha mood automatic ah maaridum 🎧",

  "Room la vibe maintain aagudhu 😄",

  "Just chill pannitu iruken 🎶",

  "Innaiku enna song kekka poringa? 😄",

  "Music + friends + good vibe... vera level 😌🎶",

  "Silent ah irundhalum music irundha podhum 🎧"
];


function getCasualMessage() {
  return chooseReply(
    CASUAL_MESSAGES
  );
}


/* -------------------------------------------------------
 * SAFE TYPING
 *
 * We do not assume a Groic typing event name.
 * ----------------------------------------------------- */

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
      "[SKVIBEZ HumanBehavior] Typing start unavailable:",
      error?.message || error
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
      "[SKVIBEZ HumanBehavior] Typing stop unavailable:",
      error?.message || error
    );

    return false;
  }
}


/* -------------------------------------------------------
 * NATURAL REPLY EXECUTION
 * ----------------------------------------------------- */

async function performReply(
  options = {}
) {
  const {
    reply,
    sendReply,
    startTyping,
    stopTyping,
    delayMs,
    username
  } = options;

  if (
    typeof sendReply !==
    "function"
  ) {
    return {
      sent: false,
      reason:
        "sendReply_function_missing"
    };
  }

  const message =
    cleanText(reply);

  if (!message) {
    return {
      sent: false,
      reason: "empty_reply"
    };
  }


  /*
   * Avoid exact duplicate reply.
   */
  if (
    isDuplicateReply(message)
  ) {
    return {
      sent: false,
      reason: "duplicate_reply"
    };
  }


  /*
   * Prevent overlapping replies.
   */
  if (replyInProgress) {
    return {
      sent: false,
      reason:
        "reply_already_in_progress"
    };
  }


  replyInProgress = true;

  let typingStarted = false;

  try {

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

    await sleep(waitTime);


    /*
     * Send reply.
     */
    await Promise.resolve(
      sendReply(message)
    );


    rememberReply(message);

    rememberUserReply(
      username
    );


    return {
      sent: true,
      reason: "reply_sent",
      delayMs: waitTime,
      typingStarted
    };

  } catch (error) {

    console.log(
      "[SKVIBEZ HumanBehavior] Reply failed:",
      error?.message || error
    );

    return {
      sent: false,
      reason: "reply_error",
      error
    };

  } finally {

    if (typingStarted) {
      await safeStopTyping(
        stopTyping
      );
    }

    replyInProgress = false;
  }
}


/* -------------------------------------------------------
 * HANDLE INCOMING MESSAGE
 * ----------------------------------------------------- */

async function handleMessage(
  message,
  options = {}
) {
  /*
   * Any room message means the room is active.
   */
  lastActivityAt =
    Date.now();


  /*
   * Duplicate protection BEFORE AI.
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


  if (!decision.reply) {
    return {
      handled: false,
      replied: false,
      reason: decision.reason
    };
  }


  let reply = "";


  /*
   * AI generates the actual contextual reply.
   */
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

            botName:
              BOT_NAME,

            botUsername:
              BOT_USERNAME
          })
        );

    } catch (error) {

      console.log(
        "[SKVIBEZ HumanBehavior] Reply generation failed:",
        error?.message || error
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


  if (!reply) {
    return {
      handled: true,
      replied: false,
      reason:
        "no_reply_generated"
    };
  }


  /*
   * Send naturally.
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

      username:
        getSenderUsername(
          message
        )
    });


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


/* -------------------------------------------------------
 * IDLE CHECK
 * ----------------------------------------------------- */

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
   * Avoid frequent idle messages.
   */
  if (
    lastIdleMessageAt > 0 &&
    sinceLastIdleMessage <
      MIN_IDLE_INTERVAL
  ) {
    return false;
  }


  /*
   * Small probability.
   */
  return (
    Math.random() <
    IDLE_MESSAGE_CHANCE
  );
}


/* -------------------------------------------------------
 * RUN IDLE CHECK
 * ----------------------------------------------------- */

async function runIdleCheck(
  options = {}
) {
  if (replyInProgress) {
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
        randomDelay()
    });


  if (result.sent) {
    lastIdleMessageAt =
      Date.now();
  }


  return result;
}


/* -------------------------------------------------------
 * IDLE SCHEDULER
 * ----------------------------------------------------- */

function scheduleNextIdleCheck(
  options = {}
) {
  if (!idleStarted) {
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

          console.log(
            "[SKVIBEZ HumanBehavior] Idle check failed:",
            error?.message || error
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


/* -------------------------------------------------------
 * START IDLE BEHAVIOR
 * ----------------------------------------------------- */

function startIdleBehavior(
  options = {}
) {
  if (idleStarted) {
    return;
  }


  if (
    typeof options.sendReply !==
    "function"
  ) {
    console.log(
      "[SKVIBEZ HumanBehavior] Idle behavior not started: sendReply is missing."
    );

    return;
  }


  idleStarted = true;

  lastActivityAt =
    Date.now();


  console.log(
    "[SKVIBEZ HumanBehavior] Idle behavior started."
  );


  scheduleNextIdleCheck(
    options
  );
}


/* -------------------------------------------------------
 * STOP IDLE BEHAVIOR
 * ----------------------------------------------------- */

function stopIdleBehavior() {
  idleStarted = false;


  if (idleTimer) {
    clearTimeout(
      idleTimer
    );

    idleTimer = null;
  }


  console.log(
    "[SKVIBEZ HumanBehavior] Idle behavior stopped."
  );
}


/* -------------------------------------------------------
 * STATE
 * ----------------------------------------------------- */

function getState() {
  return {
    botName: BOT_NAME,

    botUsername:
      BOT_USERNAME,

    replyInProgress,

    lastReply,

    lastActivityAt,

    lastIdleMessageAt,

    idleStarted,

    recentMessageCount:
      recentMessages.size,

    trackedUsers:
      userReplyHistory.size
  };
}


/* -------------------------------------------------------
 * RESET
 * ----------------------------------------------------- */

function resetState() {
  lastReply = "";

  lastActivityAt =
    Date.now();

  lastIdleMessageAt = 0;

  replyInProgress = false;

  recentMessages.clear();

  userReplyHistory.clear();
}


/* -------------------------------------------------------
 * EXPORTS
 * ----------------------------------------------------- */

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
