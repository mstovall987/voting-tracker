// Plain-English guide to Senate roll calls: what kind of vote it was, why it mattered, and what a
// Yea or Nay actually meant ("voted to overturn the rule", not just "Yea"). No DOM code here.

const CRA_RE = /congressional disapproval under chapter 8 of title 5/i;
const WAR_RE = /war powers|from hostilities/i;
const EMERGENCY_RE = /terminating the national emergency|national emergency declared/i;

/** Why a vote is flagged as a key vote (ids come from the pipeline's key_reasons()). */
export const KEY_REASON = {
  law: 'Became law',
  passage: 'Final passage',
  budget: 'Budget & spending',
  veto: 'Veto override',
  cabinet: 'Cabinet or top post',
  close: 'Close vote',
  war: 'War powers',
};

// title: short name of the vote type. what: why it matters. yea / nay: what each side voted to do
// (finishes the sentence "Voted to ..."); null when it depends on the motion.
const GUIDE = {
  confirm: {
    title: 'Confirmation vote',
    what: 'The Senate’s final vote on whether to approve the nominee. Nominees need a simple majority.',
    yea: 'confirm', nay: 'reject',
  },
  clotureNomination: {
    title: 'Cloture on a nomination',
    what: 'A vote to end debate on a nomination so the Senate can hold the confirmation vote. For nominations this needs only a simple majority.',
    yea: 'end debate', nay: 'keep debating',
  },
  cloture: {
    title: 'Cloture vote',
    what: 'A vote to end debate. On legislation it takes three-fifths of the Senate (60 votes when every seat is filled). If cloture fails, the measure stays stuck: this is how a filibuster is broken or kept.',
    yea: 'end debate', nay: 'keep debate going (blocking it for now)',
  },
  clotureProceed: {
    title: 'Cloture on starting debate',
    what: 'A vote to cut off debate on whether to even take up a bill. It usually needs 60 votes, so it is often the real test of whether a bill can get through the Senate.',
    yea: 'take up the bill', nay: 'block the bill from coming up',
  },
  proceed: {
    title: 'Motion to proceed',
    what: 'A vote on whether to start debating a measure. Winning it brings the measure to the floor; it does not pass it.',
    yea: 'start debate', nay: 'keep it off the floor',
  },
  discharge: {
    title: 'Motion to discharge',
    what: 'A vote to pull a measure out of committee and put it before the full Senate. It is the usual route for privileged measures such as war powers resolutions and regulation disapprovals.',
    yea: 'bring it to the floor', nay: 'leave it in committee',
  },
  table: {
    title: 'Motion to table',
    what: 'Tabling sets an item aside for good, which kills it. It is a common way to defeat an amendment or motion without an up-or-down vote on it.',
    yea: 'kill it (table it)', nay: 'keep it alive',
  },
  recommit: {
    title: 'Motion to recommit',
    what: 'Sends the bill back to committee, usually with instructions to change it. It is often the minority party’s attempt to amend or delay a bill.',
    yea: 'send it back to committee', nay: 'keep the bill moving',
  },
  amendment: {
    title: 'Amendment vote',
    what: 'A vote on changing the bill’s text. An amendment that passes becomes part of the bill, which still needs its own final vote.',
    yea: 'adopt the amendment', nay: 'reject the amendment',
  },
  order: {
    title: 'Point of order',
    what: 'A challenge to whether something follows Senate rules or the Budget Act, such as the "Byrd rule" limiting what a budget reconciliation bill can contain. Senators vote on the presiding officer’s ruling or on waiving the rule.',
    yea: null, nay: null,
  },
  motion: {
    title: 'Procedural motion',
    what: 'Usually a motion to waive budget rules so an amendment can be considered (which needs 60 votes), or a motion to accept the House’s version of a bill.',
    yea: null, nay: null,
  },
  veto: {
    title: 'Veto override',
    what: 'An attempt to pass a measure over the President’s veto. It needs two-thirds of senators voting, and the same in the House.',
    yea: 'override the veto', nay: 'sustain the veto',
  },
  impeachment: {
    title: 'Impeachment verdict',
    what: 'In an impeachment trial, conviction needs two-thirds of senators present.',
    yea: 'convict', nay: 'acquit',
  },
  cra: {
    title: 'Congressional Review Act resolution',
    what: 'Under the Congressional Review Act, Congress can cancel a recent federal regulation with a simple majority in both chambers plus the President’s signature. The agency is then barred from issuing a substantially similar rule.',
    yea: 'overturn the rule', nay: 'keep the rule',
  },
  war: {
    title: 'War powers resolution',
    what: 'Under the War Powers Resolution, Congress can direct the President to remove U.S. forces from hostilities it has not authorized. These measures are privileged, so any senator can force a vote.',
    yea: 'end the military action', nay: 'let the military action continue',
  },
  emergency: {
    title: 'Ending a national emergency',
    what: 'Under the National Emergencies Act, Congress can vote to end a national emergency the President declared, along with the powers that depend on it, such as some tariffs.',
    yea: 'end the emergency', nay: 'keep the emergency in place',
  },
  budgetResolution: {
    title: 'Budget resolution',
    what: 'Sets overall spending and revenue targets. It never goes to the President, but adopting it unlocks budget reconciliation, which lets a later bill pass the Senate with a simple majority instead of 60 votes.',
    yea: 'adopt the budget plan', nay: 'reject the budget plan',
  },
  resolution: {
    title: 'Resolution',
    what: 'States the view of the Senate (or of both chambers) or changes Senate rules. It does not go to the President or become law.',
    yea: 'agree to it', nay: 'oppose it',
  },
  passage: {
    title: 'Final passage',
    what: 'The Senate’s final vote on the measure itself. Once both chambers pass the same text, it goes to the President.',
    yea: 'pass it', nay: 'vote it down',
  },
  reconsider: { title: 'Motion to reconsider', what: 'A vote on whether to take an earlier vote again.', yea: null, nay: null },
  adjourn: { title: 'Motion to adjourn', what: 'A vote on whether to end the day’s session.', yea: null, nay: null },
  nominationOther: { title: 'Vote on a nomination', what: 'A procedural vote on a nomination.', yea: null, nay: null },
  other: { title: 'Roll-call vote', what: '', yea: null, nay: null },
};

function kindOf(v, bill) {
  const q = (v.q || '').trim().toLowerCase();
  const text = `${v.desc || ''} ${bill?.title || ''}`;
  if (v.cat === 'nomination') {
    if (q === 'on the nomination') return 'confirm';
    return q.includes('cloture') ? 'clotureNomination' : 'nominationOther';
  }
  if (q.includes('cloture on the motion to proceed')) return 'clotureProceed';
  if (q.includes('cloture')) return 'cloture';
  if (q === 'on the motion to proceed') return 'proceed';
  if (q === 'on the motion to discharge') return 'discharge';
  if (q === 'on the motion to table') return 'table';
  if (q === 'on the motion to recommit') return 'recommit';
  if (q === 'on the amendment') return 'amendment';
  if (q === 'on the point of order' || q === 'on the decision of the chair') return 'order';
  if (q.includes('veto')) return 'veto';
  if (q.startsWith('guilty')) return 'impeachment';
  if (v.cat === 'passage') {
    if (CRA_RE.test(text)) return 'cra';
    if (WAR_RE.test(text)) return 'war';
    if (EMERGENCY_RE.test(text)) return 'emergency';
    if (q === 'on the concurrent resolution' && /budget/i.test(text)) return 'budgetResolution';
    if (q === 'on the resolution' || q === 'on the concurrent resolution') return 'resolution';
    return 'passage';
  }
  if (q === 'on the motion') return 'motion';
  if (q === 'on the motion to reconsider') return 'reconsider';
  if (q === 'on the motion to adjourn') return 'adjourn';
  return 'other';
}

/** {title, what, yea, nay} describing the vote in plain English. */
export function explainVote(v, bill) {
  return GUIDE[kindOf(v, bill)];
}

/** "Voted to confirm", "Voted to overturn the rule", "Did not vote", ... */
export function positionMeaning(v, pos, bill) {
  if (pos === '-') return 'Did not vote';
  if (pos === 'P') return 'Voted present';
  if (pos !== 'Y' && pos !== 'N') return '';
  const guide = explainVote(v, bill);
  const phrase = pos === 'Y' ? guide.yea : guide.nay;
  return phrase ? `Voted to ${phrase}` : `Voted ${pos === 'Y' ? 'Yea' : 'Nay'}`;
}

/** What it took to win, in words. */
export function thresholdText(req) {
  return { '1/2': 'a simple majority', '3/5': 'three-fifths of the Senate (60 votes)', '2/3': 'two-thirds of senators voting' }[req] || req || 'a majority';
}
