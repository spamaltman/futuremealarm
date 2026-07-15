// timeparse.js — extract a fire time from natural speech.
// "wake me at 7:30" / "in 20 minutes" / "tomorrow morning" / "friday at 6 pm"
// Returns a Date, or null if nothing time-like was said.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Speech recognizers often emit number words for small numbers.
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90,
  a: 1, an: 1, half: 0.5,
};

function wordToNum(w) {
  if (/^\d+(\.\d+)?$/.test(w)) return parseFloat(w);
  return NUMBER_WORDS[w] ?? null;
}

export function parseTimeFromText(text, now = new Date()) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');

  // --- "in N minutes/hours/days" (also "in half an hour", "in an hour") ---
  let m = t.match(/\bin (?:about |like )?([\w.-]+)(?: an?)? (minutes?|mins?|hours?|hrs?|days?)\b/);
  if (m) {
    const n = wordToNum(m[1]);
    if (n != null) {
      const unit = m[2][0] === 'm' ? 60e3 : m[2][0] === 'h' ? 3600e3 : 86400e3;
      return new Date(now.getTime() + n * unit);
    }
  }
  m = t.match(/\bin (?:about )?an? (minute|hour)\b/);
  if (m) return new Date(now.getTime() + (m[1] === 'hour' ? 3600e3 : 60e3));

  // --- day anchor: tomorrow / tonight / weekday ---
  let dayOffset = null;
  let defaultHour = null;
  if (/\btomorrow\b/.test(t)) { dayOffset = 1; defaultHour = 7; }
  if (/\btonight\b/.test(t)) { dayOffset = 0; defaultHour = 21; }
  if (/\bthis (?:evening|afternoon)\b/.test(t)) { dayOffset = 0; defaultHour = /afternoon/.test(t) ? 15 : 19; }
  const wd = t.match(/\b(?:on |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    let diff = (WEEKDAYS.indexOf(wd[1]) - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "monday" said on a monday means next week
    dayOffset = diff;
    defaultHour = 9;
  }
  if (/\b(?:tomorrow |in the )?morning\b/.test(t) && defaultHour == null) defaultHour = 7;

  // --- clock time: "at 7", "at 7:30 pm", "at seven thirty", "7am", "noon" ---
  let hour = null, minute = 0, meridiem = null;
  if (/\b(?:at )?noon\b/.test(t)) { hour = 12; }
  else if (/\bmidnight\b/.test(t)) { hour = 0; }
  else {
    m = t.match(/\b(?:at|by|around) (\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b/)
      || t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a m|p m)?\b/)
      || t.match(/\b(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)\b/);
    if (m) {
      hour = parseInt(m[1], 10);
      minute = m[2] ? parseInt(m[2], 10) : 0;
      if (m[3]) meridiem = m[3].replace(' ', '');
      if (hour > 24 || minute > 59) { hour = null; }
    } else {
      // "at seven thirty", "at seven"
      const words = Object.keys(NUMBER_WORDS).filter(k => NUMBER_WORDS[k] >= 1 && NUMBER_WORDS[k] <= 12 && k.length > 1).join('|');
      m = t.match(new RegExp(`\\b(?:at|by|around) (${words})(?: (o'?clock|thirty|fifteen|forty-five|forty five))?( am| pm)?\\b`));
      if (m) {
        hour = NUMBER_WORDS[m[1]];
        if (m[2] === 'thirty') minute = 30;
        else if (m[2] === 'fifteen') minute = 15;
        else if (m[2] && m[2].startsWith('forty')) minute = 45;
        if (m[3]) meridiem = m[3].trim();
      }
    }
  }

  if (hour == null && defaultHour == null) return null;
  if (hour == null) { hour = defaultHour; }

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(hour, minute);
  if (dayOffset != null) {
    d.setDate(d.getDate() + dayOffset);
  } else if (d <= now) {
    // No day said and that time already passed. If no am/pm given and the pm
    // slot is still ahead today ("at 8" said at 10am → 8pm), prefer today.
    if (!meridiem && hour < 12) {
      d.setHours(hour + 12);
      if (d <= now) { d.setHours(hour); d.setDate(d.getDate() + 1); }
    } else {
      d.setDate(d.getDate() + 1);
    }
  }
  return d;
}

// Rough "did past-you give future-you a reason?" detector. Reminders that
// carry a why are the whole point; insights uses this to prove it works.
export function hasReason(text) {
  return /\b(because|so that|so you|otherwise|or else|you need|you want|it matters|don't forget why|remember why|important)\b/i
    .test(text || '');
}

// Cheap topic classifier for the analytics — what does this person keep
// having to remind themselves about?
const CATEGORIES = [
  ['wake up',      /\b(wake|get up|get out of bed|morning|alarm)\b/i],
  ['meds',         /\b(meds?|medication|medicine|pills?|vitamins?|prescription)\b/i],
  ['appointment',  /\b(appointment|meeting|interview|call|doctor|dentist|therapy|class|zoom)\b/i],
  ['leave',        /\b(leave|go to|head out|bus|train|drive|pick up|drop off)\b/i],
  ['food',         /\b(eat|lunch|dinner|breakfast|cook|food|hungry|oven|stove)\b/i],
  ['chore',        /\b(laundry|dishes|clean|trash|garbage|water the|bills?|rent|pay)\b/i],
  ['work',         /\b(deadline|submit|email|send|finish|assignment|project|homework)\b/i],
];

export function categorize(text) {
  for (const [name, re] of CATEGORIES) if (re.test(text || '')) return name;
  return 'other';
}
