/**
 * The rules TEXT lives here, server-side, as the single source of truth —
 * both frontends fetch and render it rather than hardcoding their own copy,
 * so updating the wording (and bumping FINGER_CHESS_PLATFORM_RULES_VERSION
 * to force re-acceptance) never requires touching frontend code at all.
 */
export const PLATFORM_RULES_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Respect All Players',
    body: 'Every player deserves a respectful match, win or lose. Treat opponents, spectators, and staff the way you\'d want to be treated.',
  },
  {
    title: 'No Cheating of Any Kind',
    body: 'Using a chess engine, external assistance, or any other unfair aid during a real-time match is strictly prohibited. Every real-money game is analyzed after completion specifically to detect this.',
  },
  {
    title: 'No Exploiting Bugs',
    body: 'If you find a bug that gives you an unfair advantage, report it — do not use it. Knowingly exploiting a technical flaw for gain is treated the same as cheating.',
  },
  {
    title: 'No Account Sharing',
    body: 'Your account, your wallet, your responsibility. Sharing credentials or letting someone else play on your account is not permitted.',
  },
  {
    title: 'No Abusive Language',
    body: 'Keep chat and direct messages free of profanity directed at other players, slurs, or deliberately offensive language.',
  },
  {
    title: 'No Harassment',
    body: 'Repeated unwanted contact, targeted intimidation, or any pattern of behavior intended to make another player uncomfortable is not tolerated.',
  },
  {
    title: 'No Hate Speech',
    body: 'Content that attacks or demeans people based on race, ethnicity, religion, gender, sexual orientation, disability, or similar characteristics results in immediate review.',
  },
  {
    title: 'No Threats',
    body: 'Threats of violence or harm against any person, on or off the platform, are grounds for immediate account action.',
  },
  {
    title: 'No Manipulation of the Platform',
    body: 'Match-fixing, collusion between accounts, artificially inflating stats, or manipulating matchmaking is prohibited and actively monitored for.',
  },
  {
    title: 'All Matches Are Monitored',
    body: 'Every real-money match is subject to automated and human review for fairness, integrity, and compliance with these rules.',
  },
  {
    title: 'Violations May Result in Penalties',
    body: 'Depending on severity, violations can result in chat restrictions, match forfeits, temporary suspension, or permanent account termination. See the Penalties page for specifics.',
  },
];
