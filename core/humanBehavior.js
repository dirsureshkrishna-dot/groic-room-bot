"use strict";

/*
 * ========================================
 * SK VIBEZ
 * HUMAN CHAT BEHAVIOR
 * ========================================
 *
 * Purpose:
 *
 * - Watch incoming room messages
 * - Detect direct SK VIBEZ mentions
 * - Sometimes join casual conversations
 * - Keep natural time gaps
 * - Prevent duplicate replies
 * - Use Groq AI for contextual replies
 * - Support idle room conversation
 *
 * This file does NOT create a socket.
 * The socket is provided by socket.js.
 */


/*
 * ========================================
 * CONFIG
 * ========================================
 */

const MIN_REPLY_DELAY =
  1500;

const MAX_REPLY_DELAY =
  4500;


/*
 * Minimum time between SK VIBEZ
 * replies.
 *
 * This prevents rapid replies.
 */

const MIN_REPLY_GAP =
  15000;


/*
 * Casual participation probability.
 *
 * SK VIBEZ will not answer every
 * room message.
 */

const CASUAL_REPLY_CHANCE =
  0.08;


/*
 * Incoming duplicate window.
 */

const INCOMING_DEDUPE_WINDOW =
  15000;


/*
 * Idle behavior.
 */

const IDLE_MIN_QUIET_MS =
  4 * 60 * 1000;

const IDLE_MAX_CHECK_MS =
  9 * 60 * 1000;

const IDLE_REPLY_CHANCE =
  0.18;


/*
 * ========================================
 * INTERNAL STATE
 * ========================================
 */

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
 * Recent incoming messages.
 *
 * Key:
 * username + message
 */

const recentMessages =
  new Map();


/*
 * ========================================
 * TEXT CLEANING
 * ========================================
 */

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


/*
 * ========================================
 * EXTRACT MESSAGE TEXT
 * ========================================
 */

function getMessageText(message) {

  if (
    typeof message === "string"
  ) {

    return cleanText(
      message
    );
  }


  if (
    !message ||
    typeof message !== "object"
  ) {

    return "";
  }


  const possibleValues = [

    message.message,

    message.text,

    message.content,

    message.chatMessage,

    message.body
  ];


  for (
    const value of possibleValues
  ) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {

      return cleanText(
        value
      );
    }
  }


  return "";
}


/*
 * ========================================
 * EXTRACT SENDER USERNAME
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
    message.user ||
    message.sender ||
    message.author ||
    message.profile ||
    {};


  if (
    typeof sender === "string"
  ) {

    return cleanText(
      sender
    );
  }


  const possibleNames = [

    sender.username,

    sender.userName,

    sender.name,

    message.username,

    message.userName,

    message.senderUsername
  ];


  for (
    const value of possibleNames
  ) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {

      return cleanText(
        value
      );
    }
  }


  return "";
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


  /*
   * Top-level bot flags.
   */

  if (
    message.isBot === true ||
    message.bot === true ||
    message.fromBot === true
  ) {

    return true;
  }


  /*
   * Nested sender.
   */

  const sender =
    message.user ||
    message.sender ||
    message.author ||
    message.profile ||
    {};


  if (
    sender.isBot === true ||
    sender.bot === true ||
    sender.fromBot === true
  ) {

    return true;
  }


  return false;
}


/*
 * ========================================
 * NORMALIZE USERNAME
 * ========================================
 */

function normalizeUsername(value) {

  return cleanText(
    value
  )
    .toLowerCase()
    .replace(/^@+/, "");
}


/*
 * ========================================
 * NORMALIZE MESSAGE
 * ========================================
 */

function normalizeMessage(value) {

  return cleanText(
    value
  )
    .toLowerCase();
}


/*
 * ========================================
 * IS SK VIBEZ
 * ========================================
 */

function isOwnMessage(
  username,
  botUsername,
  botName
) {

  const user =
    normalizeUsername(
      username
    );

  const bot =
    normalizeUsername(
      botUsername
    );

  const name =
    normalizeUsername(
      botName
    );


  if (
    user &&
    bot &&
    user === bot
  ) {

    return true;
  }


  if (
    user &&
    name &&
    user === name
  ) {

    return true;
  }


  return false;
}


/*
 * ========================================
 * DIRECT MENTION DETECTION
 * ========================================
 */

function isDirectMention(
  text,
  botUsername,
  botName
) {

  const normalized =
    normalizeMessage(
      text
    );


  if (!normalized) {
    return false;
  }


  const username =
    normalizeUsername(
      botUsername
    );


  const name =
    normalizeUsername(
      botName
    );


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
    containsWholeWord(
      normalized,
      username
    )
  ) {

    return true;
  }


  /*
   * sk vibez
   */

  if (
    name &&
    containsWholeWord(
      normalized,
      name
    )
  ) {

    return true;
  }


  return false;
}


/*
 * ========================================
 * WHOLE WORD CHECK
 * ========================================
 */

function containsWholeWord(
  text,
  word
) {

  if (
    !text ||
    !word
  ) {

    return false;
  }


  const escaped =
    word.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );


  const regex =
    new RegExp(
      `(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`,
      "i"
    );


  return regex.test(
    text
  );
}


/*
 * ========================================
 * DUPLICATE INCOMING MESSAGE
 * ========================================
 */

function isDuplicateIncoming(
  username,
  text
) {

  const key =
    `${normalizeUsername(username)}|${normalizeMessage(text)}`;


  const now =
    Date.now();


  /*
   * Remove old entries.
   */

  for (
    const [
      oldKey,
      timestamp
    ] of recentMessages
  ) {

    if (
      now - timestamp >
      INCOMING_DEDUPE_WINDOW
    ) {

      recentMessages.delete(
        oldKey
      );
    }
  }


  const previous =
    recentMessages.get(
      key
    );


  if (
    previous &&
    now - previous <
    INCOMING_DEDUPE_WINDOW
  ) {

    return true;
  }


  recentMessages.set(
    key,
    now
  );


  return false;
}


/*
 * ========================================
 * RANDOM DELAY
 * ========================================
 */

function randomBetween(
  min,
  max
) {

  return Math.floor(
    Math.random() *
      (max - min + 1)
  ) + min;
}


/*
 * ========================================
 * WAIT
 * ========================================
 */

function wait(ms) {

  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}


/*
 * ========================================
 * SHOULD REPLY
 * ========================================
 */

function shouldReply({
  text,
  botName,
  botUsername,
  reason
}) {

  /*
   * Direct mention:
   *
   * Always eligible.
   */

  if (
    isDirectMention(
      text,
      botUsername,
      botName
    )
  ) {

    return {
      reply: true,
      reason:
        "direct_mention"
    };
  }


  /*
   * Explicit reason from future
   * callers can force a reply.
   */

  if (
    reason ===
    "direct_mention"
  ) {

    return {
      reply: true,
      reason
    };
  }


  /*
   * Casual room participation.
   *
   * Only occasionally.
   */

  if (
    Math.random() <
    CASUAL_REPLY_CHANCE
  ) {

    return {
      reply: true,
      reason:
        "casual_room"
    };
  }


  return {
    reply: false,
    reason:
      "ignored"
  };
}


/*
 * ========================================
 * PERFORM REPLY
 * ========================================
 */

async function performReply({
  generateReply,
  sendReply,
  startTyping,
  stopTyping,
  message,
  reason,
  sender
}) {

  /*
   * Never allow overlapping replies.
   */

  if (
    replyInProgress
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Reply already in progress."
    );

    return {
      replied: false,
      reason:
        "reply_in_progress"
    };
  }


  /*
   * Global reply gap.
   */

  const now =
    Date.now();


  if (
    lastReplyAt &&
    now - lastReplyAt <
    MIN_REPLY_GAP
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Reply skipped: minimum gap."
    );

    return {
      replied: false,
      reason:
        "reply_gap"
    };
  }


  if (
    typeof generateReply !==
    "function"
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] generateReply is missing."
    );

    return {
      replied: false,
      reason:
        "generate_reply_missing"
    };
  }


  if (
    typeof sendReply !==
    "function"
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] sendReply is missing."
    );

    return {
      replied: false,
      reason:
        "send_reply_missing"
    };
  }


  replyInProgress =
    true;


  try {

    console.log(
      "[SKVIBEZ HumanBehavior] Generating reply...",
      reason
    );


    /*
     * IMPORTANT:
     *
     * Pass the COMPLETE incoming
     * message object/string to AI.
     */

    const generated =
      await generateReply({
        message,
        reason,
        sender
      });


    const reply =
      cleanText(
        generated
      );


    if (!reply) {

      console.log(
        "[SKVIBEZ HumanBehavior] AI returned empty reply."
      );


      return {
        replied: false,
        reason:
          "empty_reply"
      };
    }


    console.log(
      "[SKVIBEZ HumanBehavior] AI reply ready:",
      reply
    );


    /*
     * Human-like response delay.
     */

    const delay =
      randomBetween(
        MIN_REPLY_DELAY,
        MAX_REPLY_DELAY
      );


    console.log(
      `[SKVIBEZ HumanBehavior] Waiting ${delay}ms before sending.`
    );


    if (
      typeof startTyping ===
      "function"
    ) {

      try {

        startTyping();

      } catch (error) {

        console.log(
          "[SKVIBEZ HumanBehavior] startTyping ignored:",
          error?.message ||
          error
        );
      }
    }


    await wait(
      delay
    );


    /*
     * Check socket/sender immediately
     * before sending.
     */

    console.log(
      "[SKVIBEZ HumanBehavior] Calling sendReply..."
    );


    const sendResult =
      await sendReply(
        reply
      );


    console.log(
      "[SKVIBEZ HumanBehavior] sendReply result:",
      sendResult
    );


    lastReplyAt =
      Date.now();


    if (
      typeof stopTyping ===
      "function"
    ) {

      try {

        stopTyping();

      } catch (error) {

        console.log(
          "[SKVIBEZ HumanBehavior] stopTyping ignored:",
          error?.message ||
          error
        );
      }
    }


    return {
      replied: true,
      reason,
      reply,
      sendResult
    };

  } catch (error) {

    console.error(
      "[SKVIBEZ HumanBehavior] performReply failed:",
      error?.message ||
      error
    );


    return {
      replied: false,
      reason:
        "reply_error",
      error
    };

  } finally {

    replyInProgress =
      false;
  }
}


/*
 * ========================================
 * HANDLE INCOMING MESSAGE
 * ========================================
 */

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


  const text =
    getMessageText(
      message
    );


  if (!text) {

    console.log(
      "[SKVIBEZ HumanBehavior] Message text not found."
    );

    return {
      replied: false,
      reason:
        "no_message_text"
    };
  }


  const sender =
    getSenderUsername(
      message
    );


  /*
   * Update room activity.
   */

  lastActivityAt =
    Date.now();


  /*
   * Ignore bot messages.
   */

  if (
    isBotMessage(
      message
    )
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Ignored bot message:",
      sender
    );


    return {
      replied: false,
      reason:
        "bot_message"
    };
  }


  /*
   * Ignore own messages.
   */

  if (
    isOwnMessage(
      sender,
      botUsername,
      botName
    )
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Ignored own message."
    );


    return {
      replied: false,
      reason:
        "own_message"
    };
  }


  /*
   * Duplicate protection.
   */

  if (
    isDuplicateIncoming(
      sender,
      text
    )
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Duplicate message ignored:",
      sender,
      text
    );


    return {
      replied: false,
      reason:
        "duplicate_message"
    };
  }


  /*
   * Detect direct mention.
   */

  const directMention =
    isDirectMention(
      text,
      botUsername,
      botName
    );


  console.log(
    "[SKVIBEZ HumanBehavior] Incoming:",
    sender || "unknown",
    "=>",
    text
  );


  console.log(
    "[SKVIBEZ HumanBehavior] Direct mention:",
    directMention
  );


  /*
   * Decide whether to reply.
   */

  const decision =
    shouldReply({
      text,
      botName,
      botUsername
    });


  if (
    !decision.reply
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Message ignored naturally."
    );


    return {
      replied: false,
      reason:
        decision.reason
    };
  }


  /*
   * Direct mention should always
   * have the correct reason.
   */

  const replyReason =
    directMention
      ? "direct_mention"
      : decision.reason;


  /*
   * Generate + send reply.
   */

  return await performReply({

    generateReply,

    sendReply,

    startTyping,

    stopTyping,

    message,

    reason:
      replyReason,

    sender
  });
}


/*
 * ========================================
 * CASUAL IDLE MESSAGES
 * ========================================
 */

const IDLE_MESSAGES = [

  "Inga music vibe semma ah irukku 🎶",

  "Chill ah music ketutu iruken 😌",

  "Indha nerathukku oru nalla song venum pola 🎧",

  "Room vibe nalla poitu irukku 😄",

  "Music on, mood on 🎶",

  "Ellarum semma vibe pannitu irukinga 😄",

  "Inga vibe vera level ah irukku ✨",

  "Oru nalla melody potta perfect ah irukum 🎧",

  "Just enjoying the room vibe 😌",

  "Music + good vibes 🎶"
];


/*
 * ========================================
 * RANDOM IDLE MESSAGE
 * ========================================
 */

function randomIdleMessage() {

  return IDLE_MESSAGES[
    Math.floor(
      Math.random() *
      IDLE_MESSAGES.length
    )
  ];
}


/*
 * ========================================
 * IDLE CHECK
 * ========================================
 */

async function runIdleCheck(
  options
) {

  if (
    !idleStarted
  ) {

    return;
  }


  /*
   * Schedule next check first.
   */

  scheduleNextIdleCheck();


  /*
   * Recent room activity.
   */

  const now =
    Date.now();


  const quietFor =
    now -
    lastActivityAt;


  if (
    quietFor <
    IDLE_MIN_QUIET_MS
  ) {

    return;
  }


  /*
   * Prevent very frequent idle
   * messages.
   */

  if (
    lastIdleMessageAt &&
    now -
      lastIdleMessageAt <
      IDLE_MIN_QUIET_MS
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

    return;
  }


  if (
    typeof options?.sendReply !==
    "function"
  ) {

    return;
  }


  /*
   * Do not overlap with AI reply.
   */

  if (
    replyInProgress
  ) {

    return;
  }


  const message =
    randomIdleMessage();


  console.log(
    "[SKVIBEZ HumanBehavior] Idle message selected:",
    message
  );


  replyInProgress =
    true;


  try {

    const delay =
      randomBetween(
        MIN_REPLY_DELAY,
        MAX_REPLY_DELAY
      );


    await wait(
      delay
    );


    const result =
      await options.sendReply(
        message
      );


    lastReplyAt =
      Date.now();


    lastIdleMessageAt =
      Date.now();


    lastActivityAt =
      Date.now();


    console.log(
      "[SKVIBEZ HumanBehavior] Idle message sent:",
      result
    );

  } catch (error) {

    console.error(
      "[SKVIBEZ HumanBehavior] Idle message failed:",
      error?.message ||
      error
    );

  } finally {

    replyInProgress =
      false;
  }
}


/*
 * ========================================
 * SCHEDULE IDLE CHECK
 * ========================================
 */

function scheduleNextIdleCheck() {

  if (
    !idleStarted
  ) {

    return;
  }


  if (
    idleTimer
  ) {

    clearTimeout(
      idleTimer
    );
  }


  const delay =
    randomBetween(
      IDLE_MIN_QUIET_MS,
      IDLE_MAX_CHECK_MS
    );


  idleTimer =
    setTimeout(
      async () => {

        idleTimer =
          null;


        await runIdleCheck(
          idleOptions
        );

      },
      delay
    );


  /*
   * Do not keep Node alive
   * only because of idle timer.
   */

  if (
    typeof idleTimer.unref ===
    "function"
  ) {

    idleTimer.unref();
  }
}


/*
 * ========================================
 * IDLE OPTIONS
 * ========================================
 */

let idleOptions =
  null;


/*
 * ========================================
 * START IDLE BEHAVIOR
 * ========================================
 */

function startIdleBehavior(
  options = {}
) {

  idleOptions =
    options;


  if (
    idleStarted
  ) {

    console.log(
      "[SKVIBEZ HumanBehavior] Idle behavior already running."
    );


    return;
  }


  idleStarted =
    true;


  lastActivityAt =
    Date.now();


  console.log(
    "[SKVIBEZ HumanBehavior] Idle behavior started."
  );


  scheduleNextIdleCheck();
}


/*
 * ========================================
 * STOP IDLE BEHAVIOR
 * ========================================
 */

function stopIdleBehavior() {

  idleStarted =
    false;


  if (
    idleTimer
  ) {

    clearTimeout(
      idleTimer
    );

    idleTimer =
      null;
  }


  idleOptions =
    null;


  console.log(
    "[SKVIBEZ HumanBehavior] Idle behavior stopped."
  );
}


/*
 * ========================================
 * RESET STATE
 * ========================================
 */

function resetBehaviorState() {

  replyInProgress =
    false;

  lastReplyAt =
    0;

  lastActivityAt =
    Date.now();

  lastIdleMessageAt =
    0;

  recentMessages.clear();
}


/*
 * ========================================
 * EXPORTS
 * ========================================
 */

module.exports = {

  handleMessage,

  startIdleBehavior,

  stopIdleBehavior,

  resetBehaviorState,

  getMessageText,

  getSenderUsername,

  isBotMessage,

  isDirectMention
};
