// Curated emoji palette for the chat composer. Deliberately a compact,
// hand-picked set rather than a dependency on an emoji-picker package: the
// platform's message transport is plain UTF-8 text, so any emoji here (and
// any pasted by the user) round-trips through the encrypted at-rest storage
// and renders natively on every platform without extra infrastructure.

export interface EmojiCategory {
  label: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: 'Smileys',
    emojis: [
      '😀', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '😊', '😇',
      '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪',
      '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤨', '😐', '😑', '😶',
      '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '🤤', '😴', '😷',
      '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠',
      '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😲', '😳',
      '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖',
      '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘',
      '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚',
      '🖐️', '🖖', '👋', '🤙', '💪', '🦾', '🫶', '🫂', '🤝', '🙏',
      '👏', '💯', '👀', '🙈', '🙉', '🙊', '🤳', '💅',
    ],
  },
  {
    label: 'Hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️',
      '💌', '💋',
    ],
  },
  {
    label: 'Common',
    emojis: [
      '✅', '❌', '❗', '❓', '➕', '➖', '⭐', '🌟', '⚡', '🔥',
      '💥', '✨', '🎉', '🎊', '🎯', '🎁', '🏆', '🥇', '🥈', '🥉',
      '🏅', '♟️', '👑', '💎', '💰', '🚀', '😈', '🫡', '🍀', '🌹',
      '🤡', '👻', '🎃', '🤖', '👾', '🐶', '🐱', '🦁', '🐺', '🦊',
    ],
  },
  {
    label: 'Chess & Games',
    emojis: [
      '♔', '♕', '♖', '♗', '♘', '♙', '♚', '♛', '♜', '♝',
      '♞', '♟', '🟥', '🟨', '⬛', '⬜', '🟩', '🟦', '🟪', '🟫',
      '🎲', '🎮', '🕹️', '🧩', '🎴',
    ],
  },
];
