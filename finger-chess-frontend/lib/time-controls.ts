import { Zap, Timer, Hourglass, Crown as CrownIcon } from 'lucide-react';

export const TIME_CONTROLS = [
  { id: 'bullet_1_0', label: '1 min', category: 'Bullet', icon: Zap },
  { id: 'bullet_2_1', label: '2 | 1', category: 'Bullet', icon: Zap },
  { id: 'blitz_3_2', label: '3 | 2', category: 'Blitz', icon: Timer },
  { id: 'blitz_3_0', label: '3 | 0', category: 'Blitz', icon: Timer },
  { id: 'blitz_5_3', label: '5 | 3', category: 'Blitz', icon: Timer },
  { id: 'blitz_5_0', label: '5 | 0', category: 'Blitz', icon: Timer },
  { id: 'rapid_10_0', label: '10 min', category: 'Rapid', icon: Hourglass },
  { id: 'rapid_15_10', label: '15 | 10', category: 'Rapid', icon: Hourglass },
  { id: 'classical_30_0', label: '30 min', category: 'Classical', icon: CrownIcon },
  { id: 'classical_60_0', label: '60 min', category: 'Classical', icon: CrownIcon },
];
