// Every pairing is played once with each player as Amber (Amber moves first).
const both = (round, a, b, games = 1) => Array.from({ length: games }, (_, n) => [
  { id: `${round}--${a}--vs--${b}--${n + 1}`, amber: a, blue: b },
  { id: `${round}--${b}--vs--${a}--${n + 1}`, amber: b, blue: a },
]).flat();

export const ROUNDS = Object.freeze({
  // One game to measure time and tokens per move before committing usage.
  'pilot': [{ id: 'pilot--claude-opus-5-5--vs--bot-normal--1', amber: 'claude-opus-5-5', blue: 'bot-normal' }],
  'opus-vs-bots': [...both('r1', 'claude-opus-5-5', 'bot-normal'), ...both('r1', 'claude-opus-5-5', 'bot-hard')],
  'astra-vs-bots': [...both('r1', 'gpt-6-astra', 'bot-normal'), ...both('r1', 'gpt-6-astra', 'bot-hard')],
  'headline': both('r1', 'claude-opus-5-5', 'gpt-6-astra', 2),
});
