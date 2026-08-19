/*
 * app.js — CtrlChain Driver onboarding prototype.
 * Vanilla JS, hash-routed, single mocked state object. No build step,
 * no dependencies — deployable as-is to GitHub Pages.
 *
 * Phase 1 scope: Self-Registration and Portal-Based (magic link) New
 * Driver onboarding flows only, per the FigJam "CCA Driver App —
 * Onboarding & Pickup Journey" board.
 */

const LOGO_SVG = `
<svg class="hero__logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M62 18 A35 35 0 1 0 62 82" stroke="#8dab51" stroke-width="11" stroke-linecap="round"/>
  <rect x="53" y="46" width="14" height="14" fill="#775bc5" transform="rotate(45 60 53)"/>
</svg>`;

const MOCK_PLANNER_RECORD = {
  firstName: 'Alex',
  lastName: 'Turner',
  carrier: 'Meridian Freight Ltd',
  phone: '+44 7700 900123',
};

const SELF_REG_FLOW = ['self-reg-signup', 'self-reg-otp', 'self-reg-details', 'self-reg-gdpr', 'self-reg-pending', 'self-reg-dashboard'];
const PORTAL_FLOW = ['portal-sms', 'portal-install', 'portal-code', 'portal-confirm', 'portal-otp', 'portal-pin', 'portal-gdpr', 'portal-complete', 'portal-dashboard'];

const TITLES = {
  'welcome': '',
  'self-reg-signup': 'Create your account',
  'self-reg-otp': 'Verify your number',
  'self-reg-details': 'Your details',
  'self-reg-gdpr': 'Terms & privacy',
  'self-reg-pending': 'Almost there',
  'self-reg-dashboard': 'Dashboard',
  'portal-sms': "You've been invited",
  'portal-install': 'Get the app',
  'portal-code': 'Enter your code',
  'portal-confirm': 'Confirm your details',
  'portal-otp': 'Verify your number',
  'portal-pin': 'Secure your account',
  'portal-gdpr': 'Terms & privacy',
  'portal-complete': "You're all set",
  'portal-dashboard': 'Dashboard',
};

function freshState() {
  return {
    loginMethod: 'phone',
    phone: '',
    email: '',
    otp: '',
    firstName: '',
    lastName: '',
    gdprAccepted: false,
    approved: false,
    portalCode: '',
    portalOtp: '',
    pin: '',
    pinSkipped: false,
    portalGdprAccepted: false,
  };
}

let state = freshState();

const App = {

  nav(route) {
    window.location.hash = route;
  },

  switchFlow(flow) {
    state = freshState();
    const first = flow === 'self-reg' ? SELF_REG_FLOW[0] : PORTAL_FLOW[0];
    this.nav(first);
  },

  restartFlow() {
    const route = currentRoute();
    state = freshState();
    if (SELF_REG_FLOW.includes(route)) {
      this.nav(SELF_REG_FLOW[0]);
    } else if (PORTAL_FLOW.includes(route)) {
      this.nav(PORTAL_FLOW[0]);
    } else {
      this.nav('welcome');
    }
  },

  back() {
    window.history.back();
  },

  set(key, value) {
    state[key] = value;
  },

  setAndRerender(key, value) {
    state[key] = value;
    render();
  },

  toggle(key) {
    state[key] = !state[key];
    render();
  },

  otpInput(el, boxIndex, groupSelector, stateKey) {
    const val = el.value.replace(/[^0-9]/g, '').slice(-1);
    el.value = val;
    const boxes = Array.from(document.querySelectorAll(groupSelector));
    state[stateKey] = boxes.map(b => b.value).join('');
    if (val && boxIndex < boxes.length - 1) {
      boxes[boxIndex + 1].focus();
    }
    updateFooterState();
  },

  otpKeydown(e, boxIndex, groupSelector) {
    if (e.key === 'Backspace' && !e.target.value && boxIndex > 0) {
      const boxes = Array.from(document.querySelectorAll(groupSelector));
      boxes[boxIndex - 1].focus();
    }
  },

  pinPress(digit) {
    if (state.pin.length >= 4) return;
    state.pin += String(digit);
    if (state.pin.length === 4) {
      setTimeout(() => this.nav('portal-gdpr'), 350);
    }
    render();
  },

  pinBackspace() {
    state.pin = state.pin.slice(0, -1);
    render();
  },
};

function currentRoute() {
  return window.location.hash.replace('#', '') || 'welcome';
}

function flowOf(route) {
  if (SELF_REG_FLOW.includes(route)) return SELF_REG_FLOW;
  if (PORTAL_FLOW.includes(route)) return PORTAL_FLOW;
  return null;
}

function h(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');
}

/* ---------------------------------------------------------------- */
/* Screen renderers — each returns { content, footer, headerOverride } */
/* ---------------------------------------------------------------- */

const SCREENS = {

  'welcome': () => ({
    hideHeader: true,
    content: h`
      <div class="hero">
        ${LOGO_SVG}
        <div class="t-headline-lg hero__word">CtrlChain Driver</div>
        <div class="t-body-md hero__tagline">Moving transport forward</div>
      </div>
      <div class="t-body-md t-muted" style="padding: 0 2px;">
        This prototype covers New Driver onboarding. Choose how the driver is joining:
      </div>
      <button class="choice-card" onclick="App.switchFlow('self-reg')">
        <div class="choice-card__icon">&#128241;</div>
        <div class="choice-card__body">
          <div class="t-label-lg">Self-Registration</div>
          <div class="t-body-sm t-muted">Driver signs up on their own — no site or portal action needed first.</div>
        </div>
        <div class="choice-card__chevron">&#8250;</div>
      </button>
      <button class="choice-card" onclick="App.switchFlow('portal')">
        <div class="choice-card__icon">&#128279;</div>
        <div class="choice-card__body">
          <div class="t-label-lg">Portal-Based (Magic Link)</div>
          <div class="t-body-sm t-muted">Ops adds the driver in the CCA web portal; driver claims the account via a link.</div>
        </div>
        <div class="choice-card__chevron">&#8250;</div>
      </button>
    `,
  }),

  /* ---------------- SELF-REGISTRATION ---------------- */

  'self-reg-signup': () => ({
    content: h`
      <div class="t-body-md t-muted">No site or QR code needed — works for any pickup location.</div>
      <div class="segmented">
        <div class="segmented__opt ${state.loginMethod === 'phone' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','phone')">Phone</div>
        <div class="segmented__opt ${state.loginMethod === 'email' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','email')">Email</div>
        <div class="segmented__opt ${state.loginMethod === 'social' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','social')">Social login</div>
      </div>
      ${state.loginMethod === 'phone' ? h`
        <div class="field">
          <label class="field__label">Mobile number</label>
          <input class="field__input" type="tel" placeholder="+44 7700 900123" value="${state.phone}" oninput="App.set('phone', this.value); updateFooterState();" />
        </div>
      ` : ''}
      ${state.loginMethod === 'email' ? h`
        <div class="field">
          <label class="field__label">Email address</label>
          <input class="field__input" type="email" placeholder="you@example.com" value="${state.email}" oninput="App.set('email', this.value); updateFooterState();" />
        </div>
      ` : ''}
      ${state.loginMethod === 'social' ? h`
        <button class="btn btn-secondary" onclick="App.set('phone','google-account'); updateFooterState();">&#128172; Continue with Google</button>
        <button class="btn btn-secondary" onclick="App.set('phone','apple-account'); updateFooterState();">&#63743; Continue with Apple</button>
      ` : ''}
    `,
    footer: () => {
      const ready = state.loginMethod === 'social'
        ? !!state.phone
        : (state.loginMethod === 'phone' ? state.phone.length >= 6 : state.email.includes('@'));
      return h`<button class="btn btn-primary" ${ready ? '' : 'disabled'} onclick="App.nav('self-reg-otp')">Continue</button>`;
    },
  }),

  'self-reg-otp': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the 6-digit code we sent to ${state.loginMethod === 'email' ? (state.email || 'your email') : (state.phone || 'your number')}.</div>
      <div class="otp-row">
        ${[0,1,2,3,4,5].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'otp')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <div class="t-body-sm t-caption">Demo: any 6 digits will verify.</div>
      <button class="btn-link">Resend code</button>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.otp.length === 6 ? '' : 'disabled'} onclick="App.nav('self-reg-details')">Verify</button>`,
  }),

  'self-reg-details': () => ({
    content: h`
      <div class="t-body-md t-muted">Your vehicle isn't needed yet — that's assigned per trip, later.</div>
      <div class="field">
        <label class="field__label">First name</label>
        <input class="field__input" placeholder="Jordan" value="${state.firstName}" oninput="App.set('firstName', this.value); updateFooterState();" />
      </div>
      <div class="field">
        <label class="field__label">Last name</label>
        <input class="field__input" placeholder="Reyes" value="${state.lastName}" oninput="App.set('lastName', this.value); updateFooterState();" />
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${(state.firstName && state.lastName) ? '' : 'disabled'} onclick="App.nav('self-reg-gdpr')">Continue</button>`,
  }),

  'self-reg-gdpr': () => gdprScreen('self-reg-pending', 'gdprAccepted'),

  'self-reg-pending': () => ({
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--warning">&#8987;</div>
        <div class="t-headline-md">Account created</div>
        <span class="badge badge--warning">Pending carrier/ops verification</span>
        <div class="t-body-md t-muted">Estimated review time: <strong>~30 minutes</strong>. You'll get a push notification the moment it's approved — you don't need to keep checking.</div>
        <div class="card card--tinted" style="text-align:left; width:100%;">
          <div class="t-label-md">What happens next</div>
          <div class="t-body-sm t-muted">Ops reviews your details and assigns you to ${MOCK_PLANNER_RECORD.carrier}'s carrier group. Your profile is visible now — trip data unlocks once approved.</div>
        </div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.set('approved', false); App.nav('self-reg-dashboard')">View profile (locked)</button>
      <button class="btn btn-text" onclick="App.set('approved', true); App.nav('self-reg-dashboard')">&#128295; Simulate: ops approved my account</button>
    `,
  }),

  'self-reg-dashboard': () => ({
    content: state.approved ? h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--success">&#10003;</div>
        <div class="t-headline-md">You're approved!</div>
        <span class="badge badge--success">Full trip visibility unlocked</span>
        <div class="card" style="text-align:left; width:100%;">
          <div class="t-label-md">${state.firstName} ${state.lastName}</div>
          <div class="t-body-sm t-muted">${MOCK_PLANNER_RECORD.carrier}</div>
        </div>
        <div class="card" style="text-align:left; width:100%;">
          <div class="t-label-md">No trips assigned yet</div>
          <div class="t-body-sm t-muted">Your dashboard will show assigned trips here as a non-sequential list once dispatch assigns one.</div>
        </div>
      </div>
    ` : h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--warning">&#128274;</div>
        <div class="t-headline-md">Profile only</div>
        <span class="badge badge--warning">Trips locked until approved</span>
        <div class="card" style="text-align:left; width:100%;">
          <div class="t-label-md">${state.firstName} ${state.lastName}</div>
          <div class="t-body-sm t-muted">Awaiting carrier assignment</div>
        </div>
      </div>
    `,
    footer: () => h`<button class="btn btn-subtle" onclick="App.restartFlow()">Restart this flow</button>`,
  }),

  /* ---------------- PORTAL-BASED (MAGIC LINK) ---------------- */

  'portal-sms': () => ({
    content: h`
      <div class="t-body-md t-muted">Simulating the text message a driver receives after ops adds them in the CCA web portal.</div>
      <div class="sms-mock">
        <div class="sms-bubble">
          <div class="t-body-md">You've been added as a driver by <strong>${MOCK_PLANNER_RECORD.carrier}</strong> on CtrlChain.</div>
          <div class="t-body-sm sms-link" style="margin-top:8px;">app.ctrlchain.com/invite/8f2a1c&hellip;</div>
        </div>
      </div>
      <div class="t-body-sm t-caption">Token is hashed, single-use, ~10-15 min validity.</div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.nav('portal-install')">&#128241; Tap the link</button>`,
  }),

  'portal-install': () => ({
    content: h`
      <div class="t-body-md t-muted">A plain app-store link is sent separately from the code — no deferred deep-linking dependency.</div>
      <div class="card" style="align-items:center; text-align:center;">
        <div style="font-size:36px;">&#128241;</div>
        <div class="t-label-lg">CtrlChain Driver</div>
        <div class="t-body-sm t-muted">Install the app, then open it to continue.</div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.nav('portal-code')">Install &amp; open app</button>
      <button class="btn btn-text" onclick="App.nav('portal-code')">Already installed? Continue</button>
    `,
  }),

  'portal-code': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the code from the SMS.</div>
      <div class="otp-row">
        ${[0,1,2,3,4,5].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'portalCode')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <div class="t-body-sm t-caption">Demo: any 6 digits will work.</div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.portalCode.length === 6 ? '' : 'disabled'} onclick="App.nav('portal-confirm')">Continue</button>`,
  }),

  'portal-confirm': () => ({
    content: h`
      <div class="t-body-md t-muted">Pre-filled with what your planner entered — check it's correct.</div>
      <div class="field">
        <label class="field__label">Name</label>
        <div class="readonly-field">${MOCK_PLANNER_RECORD.firstName} ${MOCK_PLANNER_RECORD.lastName}</div>
      </div>
      <div class="field">
        <label class="field__label">Carrier</label>
        <div class="readonly-field">${MOCK_PLANNER_RECORD.carrier}</div>
      </div>
      <div class="field">
        <label class="field__label">Phone on file</label>
        <div class="readonly-field">${MOCK_PLANNER_RECORD.phone}</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.nav('portal-otp')">This is me — continue</button>`,
  }),

  'portal-otp': () => ({
    content: h`
      <div class="t-body-md t-muted">We've sent a code to ${MOCK_PLANNER_RECORD.phone} to confirm it's really you.</div>
      <div class="otp-row">
        ${[0,1,2,3,4,5].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'portalOtp')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <div class="t-body-sm t-caption">Demo: any 6 digits will verify.</div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.portalOtp.length === 6 ? '' : 'disabled'} onclick="App.nav('portal-pin')">Verify</button>`,
  }),

  'portal-pin': () => ({
    content: h`
      <div class="t-body-md t-muted" style="text-align:center;">Set a 4-digit PIN for quick sign-in next time (optional).</div>
      <div class="pin-dots">
        ${[0,1,2,3].map(i => h`<div class="pin-dot ${state.pin.length > i ? 'is-filled' : ''}"></div>`).join('')}
      </div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => h`<button class="pin-key" onclick="App.pinPress(${n})">${n}</button>`).join('')}
        <div class="pin-key pin-key--ghost"></div>
        <button class="pin-key" onclick="App.pinPress(0)">0</button>
        <button class="pin-key" onclick="App.pinBackspace()">&#9003;</button>
      </div>
    `,
    footer: () => h`<button class="btn btn-text" onclick="App.set('pinSkipped', true); App.nav('portal-gdpr')">Skip for now</button>`,
  }),

  'portal-gdpr': () => gdprScreen('portal-complete', 'portalGdprAccepted'),

  'portal-complete': () => ({
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--success">&#10003;</div>
        <div class="t-headline-md">Onboarding complete</div>
        <div class="t-body-md t-muted">You're already associated with <strong>${MOCK_PLANNER_RECORD.carrier}</strong> — no separate approval needed.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.nav('portal-dashboard')">Go to dashboard</button>`,
  }),

  'portal-dashboard': () => ({
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--success">&#128663;</div>
        <div class="t-headline-md">Welcome, ${MOCK_PLANNER_RECORD.firstName}</div>
        <span class="badge badge--success">Full trip visibility</span>
        <div class="card" style="text-align:left; width:100%;">
          <div class="t-label-md">${MOCK_PLANNER_RECORD.firstName} ${MOCK_PLANNER_RECORD.lastName}</div>
          <div class="t-body-sm t-muted">${MOCK_PLANNER_RECORD.carrier}</div>
        </div>
        <div class="card" style="text-align:left; width:100%;">
          <div class="t-label-md">No trips assigned yet</div>
          <div class="t-body-sm t-muted">Your dashboard will show assigned trips here as a non-sequential list once dispatch assigns one.</div>
        </div>
      </div>
    `,
    footer: () => h`<button class="btn btn-subtle" onclick="App.restartFlow()">Restart this flow</button>`,
  }),
};

function gdprScreen(nextRoute, stateKey) {
  return {
    content: h`
      <div class="t-body-md t-muted">Last step. This is tied to your account — you'll be asked again if terms change.</div>
      <div class="card" style="max-height:220px; overflow-y:auto;">
        <div class="t-body-sm t-muted">
          CtrlChain processes your name, phone number, and trip-related location data to operate the driver app,
          coordinate pickups and deliveries, and meet carrier obligations. Data is retained per applicable
          transport and data-protection regulations and is never sold to third parties. You may request access
          to or deletion of your data at any time via your carrier's back office.
        </div>
      </div>
      <div class="check-row" onclick="App.toggle('${stateKey}')">
        <div class="check-box ${state[stateKey] ? 'is-checked' : ''}">${state[stateKey] ? '&#10003;' : ''}</div>
        <div class="t-body-md">I have read and accept the Terms of Service and Privacy Policy.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state[stateKey] ? '' : 'disabled'} onclick="App.nav('${nextRoute}')">Accept &amp; continue</button>`,
  };
}

/* ---------------------------------------------------------------- */
/* Render loop */
/* ---------------------------------------------------------------- */

function updateFooterState() {
  const footerEl = document.querySelector('.app-footer');
  const screen = SCREENS[currentRoute()];
  if (footerEl && screen && screen().footer) {
    footerEl.innerHTML = screen().footer();
  }
}

function render() {
  const route = currentRoute();
  const screen = SCREENS[route] ? SCREENS[route]() : SCREENS['welcome']();
  const flow = flowOf(route);
  const canGoBack = flow ? flow.indexOf(route) > 0 : false;

  let headerHtml = '';
  if (!screen.hideHeader) {
    const stepIndex = flow ? flow.indexOf(route) : -1;
    const progressPct = flow ? Math.round(((stepIndex + 1) / flow.length) * 100) : 0;
    headerHtml = h`
      <div class="app-header">
        <div class="app-header__row">
          <button class="app-header__back" onclick="App.back()" ${canGoBack ? '' : 'style="visibility:hidden"'}>&#8592;</button>
          <div class="app-header__title t-headline-md">${TITLES[route] || ''}</div>
          ${flow ? h`<div class="app-header__step t-body-sm">${stepIndex + 1} / ${flow.length}</div>` : ''}
        </div>
        ${flow ? h`<div class="app-progress"><div class="app-progress__fill" style="width:${progressPct}%"></div></div>` : ''}
      </div>
    `;
  }

  const footerHtml = screen.footer ? h`<div class="app-footer">${screen.footer()}</div>` : '';

  document.getElementById('app').innerHTML = h`
    ${headerHtml}
    <div class="app-content">${screen.content}</div>
    ${footerHtml}
  `;

  document.querySelectorAll('.proto-flow-btn').forEach(btn => {
    const isActive = (btn.dataset.flow === 'self-reg' && SELF_REG_FLOW.includes(route))
      || (btn.dataset.flow === 'portal' && PORTAL_FLOW.includes(route));
    btn.classList.toggle('is-active', isActive);
  });
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
