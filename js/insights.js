// insights.js — turn the outcomes log into things the user can act on:
// what they keep asking for, and which reminders actually get them moving.

export function computeInsights(outcomes) {
  const total = outcomes.length;
  const done = outcomes.filter(o => o.action === 'done');
  const successRate = total ? done.length / total : null;
  const avgSnoozes = total ? outcomes.reduce((s, o) => s + (o.snoozes || 0), 0) / total : null;

  // --- category breakdown: count + success rate per topic ---
  const byCategory = {};
  for (const o of outcomes) {
    const c = o.category || 'other';
    byCategory[c] ??= { count: 0, done: 0 };
    byCategory[c].count++;
    if (o.action === 'done') byCategory[c].done++;
  }
  const categories = Object.entries(byCategory)
    .map(([name, v]) => ({ name, count: v.count, rate: v.done / v.count }))
    .sort((a, b) => b.count - a.count);

  // --- does saying WHY help? (the product thesis, measured) ---
  const withReason = outcomes.filter(o => o.hasReason);
  const withoutReason = outcomes.filter(o => !o.hasReason);
  const rate = arr => arr.length ? arr.filter(o => o.action === 'done').length / arr.length : null;
  const reasonEffect = (withReason.length >= 3 && withoutReason.length >= 3)
    ? { withReason: rate(withReason), withoutReason: rate(withoutReason) }
    : null;

  // --- danger hours: when do alarms get ignored/snoozed to death? ---
  const byHourBucket = {};
  for (const o of outcomes) {
    const b = bucketOf(o.hourOfDay);
    byHourBucket[b] ??= { count: 0, done: 0, snoozes: 0 };
    byHourBucket[b].count++;
    byHourBucket[b].snoozes += o.snoozes || 0;
    if (o.action === 'done') byHourBucket[b].done++;
  }
  let worstBucket = null;
  for (const [name, v] of Object.entries(byHourBucket)) {
    if (v.count >= 3) {
      const r = v.done / v.count;
      if (!worstBucket || r < worstBucket.rate) worstBucket = { name, rate: r, count: v.count };
    }
  }

  return { total, successRate, avgSnoozes, categories, reasonEffect, worstBucket };
}

function bucketOf(hour) {
  if (hour < 5) return 'late night';
  if (hour < 10) return 'early morning';
  if (hour < 13) return 'late morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export function renderInsights(el, ins) {
  if (!ins.total) {
    el.innerHTML = `<p class="empty" style="margin-top:20vh">No data yet. Every alarm you resolve teaches the app what works on you.</p>`;
    return;
  }
  const pct = x => Math.round(x * 100) + '%';
  let html = `
    <div class="stat-grid">
      <div class="stat"><div class="num">${pct(ins.successRate)}</div><div class="lbl">acted on when fired</div></div>
      <div class="stat"><div class="num">${ins.avgSnoozes.toFixed(1)}</div><div class="lbl">avg snoozes per alarm</div></div>
    </div>`;

  if (ins.reasonEffect) {
    const better = ins.reasonEffect.withReason >= ins.reasonEffect.withoutReason;
    html += `<div class="insight-line ${better ? 'good' : ''}">
      Reminders where you say <b>why it matters</b> get done ${pct(ins.reasonEffect.withReason)} of the time,
      vs ${pct(ins.reasonEffect.withoutReason)} when you don't.
      ${better ? 'Keep telling future-you the why — it works.' : ''}
    </div>`;
  }

  if (ins.worstBucket && ins.worstBucket.rate < 0.6) {
    html += `<div class="insight-line">
      Your <b>${ins.worstBucket.name}</b> alarms only land ${pct(ins.worstBucket.rate)} of the time.
      Try harsher wording, or put the device farther from the bed.
    </div>`;
  }

  html += `<h2 style="margin-top:20px">What you keep reminding yourself about</h2>`;
  const max = Math.max(...ins.categories.map(c => c.count));
  for (const c of ins.categories) {
    html += `<div class="bar-row">
      <span class="lbl">${c.name} (${c.count})</span>
      <div class="bar"><div class="fill" style="width:${(c.count / max) * 100}%; background:${c.rate < 0.5 ? 'var(--accent)' : 'var(--ok)'}"></div></div>
      <span class="pct">${pct(c.rate)}</span>
    </div>`;
  }
  html += `<p style="color:var(--muted);font-size:.75rem;margin-top:14px">Green bars: you usually do it. Red bars: this topic keeps beating you — consider recurring alarms or meaner past-you.</p>`;

  el.innerHTML = html;
}
