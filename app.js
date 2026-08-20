/*
 * app.js — CtrlChain Driver onboarding prototype.
 * Vanilla JS, hash-routed, single mocked state object. No build step,
 * no dependencies — deployable as-is to GitHub Pages.
 *
 * Phase 1 scope: all four New Driver / returning-driver entry paths
 * (Self-Registration, Portal-Based magic link, Returning Driver,
 * Guest/One-Off) plus a shared Dashboard, per the FigJam
 * "CCA Driver App — Onboarding & Pickup Journey" board. Milestone
 * confirmation, exceptions, and communication are Phase 2.
 */

const MOCK_PLANNER_RECORD = {
  firstName: 'Alex',
  lastName: 'Turner',
  carrier: 'Meridian Freight Ltd',
  phone: '+44 7700 900123',
};

const MOCK_RETURNING_DRIVER = { firstName: 'Jordan', lastName: 'Reyes', carrier: 'Meridian Freight Ltd', phone: '+44 7700 900456' };

const MOCK_TRIPS = [
  { id: 'TRIP2026-000123', pickup: 'Meridian Distribution Centre, Coventry', dropoff: 'Aldi RDC, Bristol', status: 'Upcoming', badge: 'info', eta: 'Today, 14:30' },
  { id: 'TRIP2026-000124', pickup: 'Heathrow Cargo Terminal', dropoff: 'Southampton Docks', status: 'Scheduled', badge: 'warning', eta: 'Tomorrow, 08:00' },
];

const MOCK_GUEST_TRIP = { id: 'TRIP2026-000142', pickup: 'Heathrow Cargo Terminal', dropoff: 'Southampton Docks', status: 'In progress', badge: 'info', eta: 'Today, 16:00' };

/* Mocked native OAuth account-chooser sheets — one per social provider, styled after
   each provider's real embedded sign-in UI rather than CCA's own visual system. */
const OAUTH_PROVIDERS = {
  google: {
    label: 'Google', domain: 'accounts.google.com', logo: 'assets/social-google.svg',
    share: 'name, email address, language preference, and profile picture',
    accounts: [
      { name: 'Jordan Reyes', email: 'jordan.reyes@gmail.com', initial: 'J', color: '#7c5cbf', signedOut: true },
      { name: 'Alex Turner', email: 'alex.turner@gmail.com', initial: 'A', color: '#3f7fbf' },
    ],
  },
  apple: {
    label: 'Apple', domain: 'appleid.apple.com', logo: 'assets/social-apple.svg',
    share: 'name and email address',
    accounts: [
      { name: 'Jordan Reyes', email: 'jordan.reyes@icloud.com', initial: 'J', color: '#5a5a5f' },
    ],
  },
  facebook: {
    label: 'Facebook', domain: 'facebook.com', logo: 'assets/social-facebook.svg',
    share: 'name, email address, and profile picture',
    accounts: [
      { name: 'Jordan Reyes', email: 'jordan.reyes@outlook.com', initial: 'J', color: '#3b5998' },
    ],
  },
};

/* Returns whichever mock driver record the currently-displayed portal-flow screen should show —
   the original portal onboarding record, or the returning driver's own record when these same
   screens are being reused for an account-reactivation request. */
function currentPortalRecord() {
  return state.reactivating ? MOCK_RETURNING_DRIVER : MOCK_PLANNER_RECORD;
}

/* Route metadata: { flow, step, total } for progress display. null = terminal/no-flow screen. */
const ROUTE_META = {
  'welcome': null,
  'self-reg-welcome': null,
  'self-reg-social-google': null,
  'self-reg-social-apple': null,
  'self-reg-social-facebook': null,
  'self-reg-signup': { flow: 'self-reg', step: 1, total: 7 },
  'self-reg-otp': { flow: 'self-reg', step: 2, total: 7 },
  'self-reg-password': { flow: 'self-reg', step: 3, total: 7 },
  'self-reg-details': { flow: 'self-reg', step: 4, total: 7 },
  'self-reg-gdpr': { flow: 'self-reg', step: 5, total: 7 },
  'self-reg-pin': { flow: 'self-reg', step: 6, total: 7 },
  'self-reg-pending': { flow: 'self-reg', step: 7, total: 7 },
  'portal-sms': { flow: 'portal', step: 1, total: 8 },
  'portal-install': { flow: 'portal', step: 2, total: 8 },
  'portal-code': { flow: 'portal', step: 3, total: 8 },
  'portal-confirm': { flow: 'portal', step: 4, total: 8 },
  'portal-otp': { flow: 'portal', step: 5, total: 8 },
  'portal-pin': { flow: 'portal', step: 6, total: 8 },
  'portal-gdpr': { flow: 'portal', step: 7, total: 8 },
  'portal-complete': { flow: 'portal', step: 8, total: 8 },
  'returning-entry': { flow: 'returning', step: 1, total: 2 },
  'returning-pin': { flow: 'returning', step: 2, total: 2 },
  'returning-password': { flow: 'returning', step: 2, total: 2 },
  'returning-request-activation': { flow: 'returning', step: 2, total: 3 },
  'returning-activation-sent': { flow: 'returning', step: 3, total: 3 },
  'guest-sms': { flow: 'guest', step: 1, total: 3 },
  'guest-trust': { flow: 'guest', step: 2, total: 3 },
  'guest-scoped': { flow: 'guest', step: 3, total: 3 },
  'location-priming': null,
  'location-os-prompt-1': null,
  'location-os-prompt-2': null,
  'location-denied': null,
  'dashboard': null,
  'trip-detail': null,
};

const FLOW_FIRST_ROUTE = { 'self-reg': 'self-reg-welcome', 'portal': 'portal-sms', 'returning': 'returning-entry', 'guest': 'guest-sms' };
const FLOW_LABELS = { 'self-reg': 'Self-Registration', 'portal': 'Portal-Based (Magic Link)', 'returning': 'Returning Driver', 'guest': 'Guest / One-Off' };

const TITLES = {
  'welcome': '',
  'self-reg-welcome': '',
  'self-reg-signup': 'Create your account',
  'self-reg-otp': 'Verify your number',
  'self-reg-password': 'Set a password',
  'self-reg-details': 'Your details',
  'self-reg-gdpr': 'Terms & privacy',
  'self-reg-pin': 'Secure your account',
  'self-reg-pending': 'Almost there',
  'portal-sms': "You've been invited",
  'portal-install': 'Get the app',
  'portal-code': 'Enter your code',
  'portal-confirm': 'Confirm your details',
  'portal-otp': 'Verify your number',
  'portal-pin': 'Secure your account',
  'portal-gdpr': 'Terms & privacy',
  'portal-complete': "You're all set",
  'returning-entry': 'Welcome back',
  'returning-pin': 'Quick sign-in',
  'returning-password': 'Session expired',
  'returning-request-activation': 'Reactivate your account',
  'returning-activation-sent': 'Enter code',
  'guest-sms': 'Guest access',
  'guest-trust': "You've been added",
  'guest-scoped': 'Single-trip access',
  'dashboard': 'Dashboard',
  'trip-detail': 'Trip details',
};

function freshState() {
  return {
    activeFlow: null,
    loginMethod: 'phone',
    phone: '',
    email: '',
    otp: '',
    password: '',
    firstName: '',
    lastName: '',
    gdprAccepted: false,
    portalCode: '',
    portalOtp: '',
    pin: '',
    pinTarget: 'dashboard',
    portalGdprAccepted: false,
    dashboardMode: 'full', // 'locked' | 'full' | 'guest'
    returningOrigin: 'self-reg', // 'self-reg' | 'portal' — which onboarding path this returning driver used
    returningEmail: '',
    returningPassword: '',
    reactivationContact: '',
    reactivationCode: '',
    reactivating: false,
    selectedTripId: null,
    locationPermission: null, // null | 'always' | 'while-using' | 'denied'
  };
}

let state = freshState();

/* Explicit in-app navigation stack, not the browser's history. window.history
   is unreliable here: it survives restartFlow()/switchFlow() resetting state,
   so the browser's "back" could land on a screen built for a driver record
   that no longer exists, and it does nothing predictable when there's no
   prior entry at all (e.g. the very first screen in a fresh tab). This stack
   is cleared exactly when state is, so it can never point at a stale screen. */
let navHistory = [];

function setHash(route) {
  if (window.location.hash === '#' + route) {
    // Setting hash to its current value doesn't fire 'hashchange' — render
    // directly so navigating "back to" the screen you're already on (e.g.
    // restarting a flow from its own landing screen) still takes effect.
    render();
  } else {
    window.location.hash = route;
  }
}

const App = {

  nav(route) {
    const current = currentRoute();
    if (current !== route) navHistory.push(current);
    setHash(route);
  },

  switchFlow(flow) {
    state = freshState();
    navHistory = [];
    state.activeFlow = flow;
    // setHash, not this.nav — nav() would push the pre-reset route onto the
    // (just-cleared) history, letting "back" step into a screen this fresh
    // state no longer matches.
    setHash(FLOW_FIRST_ROUTE[flow]);
  },

  restartFlow() {
    const meta = ROUTE_META[currentRoute()];
    const flow = state.activeFlow || (meta && meta.flow) || null;
    state = freshState();
    navHistory = [];
    if (flow) {
      state.activeFlow = flow;
      setHash(FLOW_FIRST_ROUTE[flow]);
    } else {
      setHash('welcome');
    }
  },

  back() {
    setHash(navHistory.pop() || 'welcome');
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

  toggleTheme() {
    const html = document.documentElement;
    const goingDark = !html.classList.contains('dark');
    html.classList.remove('light', 'dark');
    html.classList.add(goingDark ? 'dark' : 'light');
    try { localStorage.setItem('cca-theme', goingDark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
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
      setTimeout(() => {
        if (state.pinTarget === 'dashboard') {
          this.enterDashboard(state.dashboardMode);
        } else {
          this.nav(state.pinTarget);
        }
      }, 350);
    }
    render();
  },

  pinBackspace() {
    state.pin = state.pin.slice(0, -1);
    render();
  },

  viewTrip(id) {
    state.selectedTripId = id;
    this.nav('trip-detail');
  },

  approveDashboard() {
    state.dashboardMode = 'full';
    if (!state.locationPermission) {
      this.nav('location-priming');
    } else {
      render();
    }
  },

  /* Single entry point for "land on the dashboard" — the moment of first real
     trip visibility, and per permission-priming best practice, the right moment
     to ask for location access rather than asking blindly during onboarding. */
  enterDashboard(mode) {
    state.dashboardMode = mode;
    if (!state.locationPermission) {
      this.nav('location-priming');
    } else {
      this.nav('dashboard');
    }
  },
};

function currentRoute() {
  return window.location.hash.replace('#', '') || 'welcome';
}

function h(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');
}

function tripCard(trip, clickable) {
  return h`
    <div class="card trip-card" ${clickable ? `onclick="App.viewTrip('${trip.id}')"` : ''}>
      <div class="trip-card__top">
        <span class="t-label-md">${trip.id}</span>
        <span class="badge badge--${trip.badge}">${trip.status}</span>
      </div>
      <div class="t-body-sm t-muted">${trip.pickup} &#8594; ${trip.dropoff}</div>
      <div class="t-body-sm t-caption">ETA ${trip.eta}</div>
    </div>
  `;
}

/* ---------------------------------------------------------------- */
/* Screen renderers */
/* ---------------------------------------------------------------- */

const SCREENS = {

  'welcome': () => ({
    hideHeader: true,
    content: h`
      <div class="hero">
        <img class="hero__logo" src="assets/logo-white.svg" alt="CtrlChain" />
        <div class="t-body-md hero__tagline">Moving transport forward</div>
      </div>
      <div class="t-body-md t-muted" style="padding: 0 2px;">
        This prototype covers driver onboarding and the dashboard. Choose an entry path:
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
      <button class="choice-card" onclick="App.switchFlow('returning')">
        <div class="choice-card__icon">&#128260;</div>
        <div class="choice-card__body">
          <div class="t-label-lg">Returning Driver</div>
          <div class="t-body-sm t-muted">Already has an account — quick PIN/Face ID sign-in, or reactivation if the session expired.</div>
        </div>
        <div class="choice-card__chevron">&#8250;</div>
      </button>
      <button class="choice-card" onclick="App.switchFlow('guest')">
        <div class="choice-card__icon">&#127915;</div>
        <div class="choice-card__body">
          <div class="t-label-lg">Guest / One-Off Driver</div>
          <div class="t-body-sm t-muted">Subcontracted for a single trip — scoped access, no account created.</div>
        </div>
        <div class="choice-card__chevron">&#8250;</div>
      </button>
    `,
  }),

  /* ---------------- SELF-REGISTRATION ---------------- */

  'self-reg-welcome': () => ({
    hideHeader: true,
    transparentStatusBar: true,
    content: h`
      <div class="launch-hero">
        <div class="launch-hero__sheen"></div>
        <div class="launch-hero__body">
          <div class="launch-hero__mark">
            <span class="launch-hero__mark-ring"></span>
            <img class="launch-hero__icon" src="assets/logo-icon-white.svg" alt="" />
          </div>
          <div class="launch-hero__wordmark">CtrlChain</div>
          <div class="launch-hero__tagline">Moving transport forward</div>
        </div>
        <div class="launch-hero__actions" role="group" aria-label="Sign up or log in options">
          <div class="launch-hero__divider"><span>Sign up or log in with</span></div>
          <button class="btn btn-social" onclick="App.nav('self-reg-social-google')">
            <img class="btn-social__icon" src="assets/social-google.svg" alt="" /> Continue with Google
          </button>
          <button class="btn btn-social" onclick="App.nav('self-reg-social-apple')">
            <img class="btn-social__icon" src="assets/social-apple.svg" alt="" /> Continue with Apple
          </button>
          <button class="btn btn-social" onclick="App.nav('self-reg-social-facebook')">
            <img class="btn-social__icon" src="assets/social-facebook.svg" alt="" /> Continue with Facebook
          </button>
          <div class="launch-hero__divider launch-hero__divider--secondary"><span>Continue with</span></div>
          <button class="btn launch-hero__secondary" onclick="App.nav('self-reg-signup')">Email or phone number</button>
          <button class="btn-link launch-hero__signin" onclick="App.switchFlow('returning')">Already have an account? Sign in</button>
        </div>
      </div>
    `,
  }),

  'self-reg-social-google': () => oauthConsentScreen('google'),
  'self-reg-social-apple': () => oauthConsentScreen('apple'),
  'self-reg-social-facebook': () => oauthConsentScreen('facebook'),

  'self-reg-signup': () => ({
    content: h`
      <div class="t-body-md t-muted">No site or QR code needed — works for any pickup location.</div>
      <div class="segmented">
        <div class="segmented__opt ${state.loginMethod === 'phone' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','phone')">Phone</div>
        <div class="segmented__opt ${state.loginMethod === 'email' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','email')">Email</div>
      </div>
      ${state.loginMethod === 'phone' ? h`
        <div class="field">
          <label class="field__label">Mobile number</label>
          <div class="phone-input">
            <button type="button" class="phone-input__code" aria-label="Change country code">
              <span class="phone-input__flag">&#127475;&#127473;</span>
              <span>+31</span>
              <svg class="phone-input__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="phone-input__number-wrap">
              <input class="phone-input__number" type="tel" inputmode="numeric" placeholder="6 12345678" value="${state.phone}" oninput="App.set('phone', this.value); this.nextElementSibling.style.visibility = this.value ? 'visible' : 'hidden'; updateFooterState();" />
              <button type="button" class="phone-input__clear" aria-label="Clear" style="visibility:${state.phone ? 'visible' : 'hidden'}" onclick="App.setAndRerender('phone','')">&#10005;</button>
            </div>
          </div>
        </div>
      ` : ''}
      ${state.loginMethod === 'email' ? h`
        <div class="field">
          <label class="field__label">Email address</label>
          <input class="field__input" type="email" placeholder="you@example.com" value="${state.email}" oninput="App.set('email', this.value); updateFooterState();" />
        </div>
      ` : ''}
    `,
    footer: () => {
      const ready = state.loginMethod === 'phone' ? state.phone.length >= 6 : state.email.includes('@');
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
    footer: () => h`<button class="btn btn-primary" ${state.otp.length === 6 ? '' : 'disabled'} onclick="App.nav('self-reg-password')">Verify</button>`,
  }),

  'self-reg-password': () => ({
    content: h`
      <div class="t-body-md t-muted">Set a password so you can sign back in later, even if this device is reset or replaced.</div>
      <div class="field">
        <label class="field__label">Password</label>
        <input class="field__input" type="password" placeholder="At least 8 characters" value="${state.password}" oninput="App.set('password', this.value); updateFooterState();" />
        <div class="field__hint">Use at least 8 characters.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.password.length >= 8 ? '' : 'disabled'} onclick="App.nav('self-reg-details')">Continue</button>`,
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

  'self-reg-gdpr': () => gdprScreen('self-reg-pin', 'gdprAccepted', 'self-reg-pending'),

  'self-reg-pin': () => pinScreen('setup'),

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
    footer: () => h`<button class="btn btn-primary" onclick="App.set('dashboardMode','locked'); App.nav('dashboard')">Continue to dashboard</button>`,
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

  'portal-confirm': () => {
    const record = currentPortalRecord();
    return {
      content: h`
        <div class="t-body-md t-muted">${state.reactivating ? "Pre-filled with what's already on file — check it's still correct." : "Pre-filled with what your planner entered — check it's correct."}</div>
        <div class="field">
          <label class="field__label">Name</label>
          <div class="readonly-field">${record.firstName} ${record.lastName}</div>
        </div>
        <div class="field">
          <label class="field__label">Carrier</label>
          <div class="readonly-field">${record.carrier}</div>
        </div>
        <div class="field">
          <label class="field__label">Phone on file</label>
          <div class="readonly-field">${record.phone}</div>
        </div>
      `,
      footer: () => h`<button class="btn btn-primary" onclick="App.nav('portal-otp')">This is me — continue</button>`,
    };
  },

  'portal-otp': () => {
    const record = currentPortalRecord();
    return {
      content: h`
        <div class="t-body-md t-muted">We've sent a code to ${record.phone} to confirm it's really you.</div>
        <div class="otp-row">
          ${[0,1,2,3,4,5].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'portalOtp')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
        </div>
        <div class="t-body-sm t-caption">Demo: any 6 digits will verify.</div>
      `,
      footer: () => h`<button class="btn btn-primary" ${state.portalOtp.length === 6 ? '' : 'disabled'} onclick="App.set('pinTarget','portal-gdpr'); App.nav('portal-pin')">Verify</button>`,
    };
  },

  'portal-pin': () => pinScreen('setup'),

  'portal-gdpr': () => gdprScreen('portal-complete', 'portalGdprAccepted'),

  'portal-complete': () => {
    const record = currentPortalRecord();
    return {
      content: h`
        <div class="center-state">
          <div class="center-state__icon center-state__icon--success">&#10003;</div>
          <div class="t-headline-md">${state.reactivating ? 'Access restored' : 'Onboarding complete'}</div>
          <div class="t-body-md t-muted">You're ${state.reactivating ? 'back in, still' : 'already'} associated with <strong>${record.carrier}</strong> — no separate approval needed.</div>
        </div>
      `,
      footer: () => h`<button class="btn btn-primary" onclick="App.enterDashboard('full')">Go to dashboard</button>`,
    };
  },

  /* ---------------- RETURNING DRIVER ---------------- */

  'returning-entry': () => ({
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--success">&#128241;</div>
        <div class="t-headline-md">Open app</div>
        <div class="t-body-md t-muted">The app checks your session automatically. For this prototype, pick which case to explore — matches the "Session Expired?" check already in the current app:</div>
      </div>
      <div class="field">
        <label class="field__label">Simulate: how did this driver originally sign up?</label>
        <div class="segmented">
          <div class="segmented__opt ${state.returningOrigin === 'self-reg' ? 'is-selected' : ''}" onclick="App.setAndRerender('returningOrigin','self-reg')">Self-Registered</div>
          <div class="segmented__opt ${state.returningOrigin === 'portal' ? 'is-selected' : ''}" onclick="App.setAndRerender('returningOrigin','portal')">Portal-Based</div>
        </div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.set('pinTarget','dashboard'); App.set('dashboardMode','full'); App.nav('returning-pin')">&#128274; Simulate: session not expired</button>
      <button class="btn btn-secondary" onclick="App.nav(state.returningOrigin === 'portal' ? 'returning-request-activation' : 'returning-password')">&#8987; Simulate: session expired</button>
    `,
  }),

  'returning-pin': () => pinScreen('unlock'),

  'returning-password': () => ({
    content: h`
      <div class="t-body-md t-muted">Your session expired — the device doesn't have you signed in anymore. Sign in the same way you originally set up your account.</div>
      <div class="field">
        <label class="field__label">Email address</label>
        <input class="field__input" type="email" placeholder="you@example.com" value="${state.returningEmail}" oninput="App.set('returningEmail', this.value); updateFooterState();" />
      </div>
      <div class="field">
        <label class="field__label">Password</label>
        <input class="field__input" type="password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" value="${state.returningPassword}" oninput="App.set('returningPassword', this.value); updateFooterState();" />
      </div>
      <button class="btn-link">Forgot password?</button>
    `,
    footer: () => h`<button class="btn btn-primary" ${(state.returningEmail.includes('@') && state.returningPassword.length >= 4) ? '' : 'disabled'} onclick="App.enterDashboard('full')">Sign in</button>`,
  }),

  'returning-request-activation': () => ({
    content: h`
      <div class="t-body-md t-muted">Portal-Based accounts don't have a separate password — your PIN or Face ID is the only way in. Enter the email or phone number on your account to reactivate it.</div>
      <div class="field">
        <label class="field__label">Email or phone number</label>
        <input class="field__input" type="text" placeholder="you@example.com or +31 6 12345678" value="${state.reactivationContact}" oninput="App.set('reactivationContact', this.value); updateFooterState();" />
      </div>
      <div class="card card--tinted">
        <div class="t-label-md">What happens next</div>
        <div class="t-body-sm t-muted">We'll automatically send an 8-digit code to confirm it's you — no approval wait, and nothing for your carrier's ops team to action.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.reactivationContact.trim().length >= 4 ? '' : 'disabled'} onclick="App.nav('returning-activation-sent')">Reactivate my account</button>`,
  }),

  'returning-activation-sent': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the 8-digit code we sent to ${state.reactivationContact}.</div>
      <div class="otp-row otp-row--compact">
        ${[0,1,2,3,4,5,6,7].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'reactivationCode')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <div class="t-body-sm t-caption">Demo: any 8 digits will verify.</div>
      <button class="btn-link">Resend code</button>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.reactivationCode.length === 8 ? '' : 'disabled'} onclick="App.set('reactivating', true); App.nav('portal-confirm')">Verify</button>`,
  }),

  /* ---------------- GUEST / ONE-OFF DRIVER ---------------- */

  'guest-sms': () => ({
    content: h`
      <div class="t-body-md t-muted">Simulating the message a subcontracted driver receives for a single trip — no account required.</div>
      <div class="sms-mock">
        <div class="sms-bubble">
          <div class="t-body-md">You've been given temporary access to <strong>Trip ${MOCK_GUEST_TRIP.id}</strong> by <strong>${MOCK_PLANNER_RECORD.carrier}</strong>.</div>
          <div class="t-body-sm sms-link" style="margin-top:8px;">app.ctrlchain.com/trip/${MOCK_GUEST_TRIP.id}?t=e91a&hellip;</div>
        </div>
      </div>
      <div class="t-body-sm t-caption">Hashed, single-use token (~10-15 min validity) — app-store link sent separately if not yet installed.</div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.nav('guest-trust')">&#128241; Tap the link</button>`,
  }),

  'guest-trust': () => ({
    content: h`
      <div class="card card--tinted" style="text-align:center; align-items:center; padding:28px 20px;">
        <div style="font-size:32px;">&#9989;</div>
        <div class="t-headline-md">You've been added to Trip ${MOCK_GUEST_TRIP.id} by ${MOCK_PLANNER_RECORD.carrier}</div>
        <div class="t-body-sm t-muted">Shown first, before anything else — so it's immediately clear who this is from and why.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.nav('guest-scoped')">Continue</button>`,
  }),

  'guest-scoped': () => ({
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--success">&#128274;</div>
        <div class="t-headline-md">Scoped single-trip access</div>
        <div class="t-body-md t-muted">No email, no password, no account created. Access ends automatically when the trip is complete.</div>
        ${tripCard(MOCK_GUEST_TRIP, false)}
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.enterDashboard('guest')">Continue to trip</button>`,
  }),

  /* ---------------- LOCATION PERMISSION PRIMING ----------------
     Shown once, contextually, the first time a driver would actually see a
     real trip — not blindly during onboarding. Requests "Always" because V1's
     geofence-assisted arrival detection only works with the app backgrounded;
     "While Using" can't support that. The native-style screens deliberately
     model iOS's real two-step Always flow (first ask never offers Always
     outright) since that's exactly what CtrlChain's own app has shipped bugs
     around before (re-prompting after already granted, going "active" without
     real permission) — see onboarding-design-decisions.md. */

  'location-priming': () => ({
    hideHeader: true,
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--success">&#128205;</div>
        <div class="t-headline-md">Enable location for automatic tracking</div>
        <div class="t-body-md t-muted">CtrlChain uses your location to automatically detect pickup arrival and share live ETA — so you're not manually updating every milestone. Updates are sent periodically, not continuously, to save battery.</div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.nav('location-os-prompt-1')">Enable location</button>
      <button class="btn-text" onclick="App.set('locationPermission','while-using'); App.nav('dashboard')">Not now</button>
    `,
  }),

  'location-os-prompt-1': () => ({
    hideHeader: true,
    content: h`
      <div class="os-alert-backdrop">
        <div class="os-alert">
          <div class="os-alert__title">Allow &ldquo;CtrlChain&rdquo; to use your location?</div>
          <div class="os-alert__message">Your location is used to detect pickup arrival and share live trip updates with your carrier.</div>
          <div class="os-alert__actions">
            <button class="os-alert__btn" onclick="App.set('locationPermission','while-using'); App.nav('location-os-prompt-2')">Allow Once</button>
            <button class="os-alert__btn" onclick="App.set('locationPermission','while-using'); App.nav('location-os-prompt-2')">Allow While Using App</button>
            <button class="os-alert__btn os-alert__btn--muted" onclick="App.set('locationPermission','denied'); App.nav('location-denied')">Don't Allow</button>
          </div>
        </div>
      </div>
    `,
  }),

  'location-os-prompt-2': () => ({
    hideHeader: true,
    content: h`
      <div class="os-alert-backdrop">
        <div class="os-alert">
          <div class="os-alert__title">Allow &ldquo;CtrlChain&rdquo; to also access your location even when you're not using the app?</div>
          <div class="os-alert__message">This lets CtrlChain detect your arrival automatically, even if the app isn't open while you're driving.</div>
          <div class="os-alert__actions">
            <button class="os-alert__btn os-alert__btn--muted" onclick="App.nav('dashboard')">Keep Only While Using</button>
            <button class="os-alert__btn" onclick="App.set('locationPermission','always'); App.nav('dashboard')">Change to Always Allow</button>
          </div>
        </div>
      </div>
    `,
  }),

  'location-denied': () => ({
    hideHeader: true,
    content: h`
      <div class="center-state">
        <div class="center-state__icon center-state__icon--warning">&#9888;</div>
        <div class="t-headline-md">Location access needed</div>
        <div class="t-body-md t-muted">Without location access, arrival and ETA won't update automatically — you'll need to confirm each milestone manually. You can enable it anytime in Settings.</div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.nav('location-priming')">&#128241; Simulate: return from Settings, try again</button>
      <button class="btn-text" onclick="App.nav('dashboard')">Continue without location</button>
    `,
  }),

  /* ---------------- SHARED DASHBOARD ---------------- */

  'dashboard': () => {
    if (state.dashboardMode === 'locked') {
      return {
        content: h`
          <div class="center-state">
            <div class="center-state__icon center-state__icon--warning">&#128274;</div>
            <div class="t-headline-md">Profile only</div>
            <span class="badge badge--warning">Trips locked until approved</span>
            <div class="card" style="text-align:left; width:100%;">
              <div class="t-label-md">${state.firstName || 'New'} ${state.lastName || 'Driver'}</div>
              <div class="t-body-sm t-muted">Awaiting carrier assignment</div>
            </div>
          </div>
        `,
        footer: () => h`
          <button class="btn btn-text" onclick="App.approveDashboard()">&#128295; Simulate: ops approved my account</button>
          <button class="btn btn-subtle" onclick="App.restartFlow()">Restart this flow</button>
        `,
      };
    }
    if (state.dashboardMode === 'guest') {
      return {
        content: h`
          ${trackingStatusBanner()}
          <span class="badge badge--info">Guest access — this trip only</span>
          <div class="t-headline-sm" style="margin-top:4px;">Your trip</div>
          ${tripCard(MOCK_GUEST_TRIP, true)}
          <div class="card" style="margin-top:4px;">
            <div class="t-body-sm t-muted">This access ends automatically once the trip is marked complete — nothing to clean up.</div>
          </div>
        `,
        footer: () => h`<button class="btn btn-subtle" onclick="App.restartFlow()">Restart this flow</button>`,
      };
    }
    // full
    const name = state.activeFlow === 'self-reg' ? `${state.firstName} ${state.lastName}`
      : state.activeFlow === 'returning' ? `${MOCK_RETURNING_DRIVER.firstName} ${MOCK_RETURNING_DRIVER.lastName}`
      : `${MOCK_PLANNER_RECORD.firstName} ${MOCK_PLANNER_RECORD.lastName}`;
    const carrier = state.activeFlow === 'self-reg' ? MOCK_PLANNER_RECORD.carrier
      : state.activeFlow === 'returning' ? MOCK_RETURNING_DRIVER.carrier
      : MOCK_PLANNER_RECORD.carrier;
    return {
      content: h`
        ${trackingStatusBanner()}
        <div class="t-headline-md">Welcome, ${name.split(' ')[0] || 'driver'}</div>
        <div class="t-body-sm t-muted">${carrier}</div>
        <span class="badge badge--success">Full trip visibility</span>
        <div class="t-headline-sm" style="margin-top:8px;">Your trips</div>
        <div class="t-body-sm t-caption">Non-sequential list — tap any trip for details.</div>
        ${MOCK_TRIPS.map(t => tripCard(t, true)).join('')}
      `,
      footer: () => h`<button class="btn btn-subtle" onclick="App.restartFlow()">Restart this flow</button>`,
    };
  },

  'trip-detail': () => {
    const trip = MOCK_TRIPS.concat([MOCK_GUEST_TRIP]).find(t => t.id === state.selectedTripId) || MOCK_TRIPS[0];
    return {
      content: h`
        <span class="badge badge--${trip.badge}">${trip.status}</span>
        <div class="card" style="width:100%;">
          <div class="t-label-lg">${trip.id}</div>
          <div class="t-body-md">${trip.pickup}</div>
          <div class="t-body-sm t-caption">&#8595; pickup</div>
          <div class="t-body-md">${trip.dropoff}</div>
          <div class="t-body-sm t-caption">&#8593; drop-off</div>
        </div>
        <div class="card">
          <div class="t-label-md">ETA</div>
          <div class="t-body-sm t-muted">${trip.eta}</div>
        </div>
        <div class="card card--tinted">
          <div class="t-body-sm t-muted">Milestone confirmation, structured exception reporting, and back-office communication for this trip are Phase 2 — not in this prototype yet.</div>
        </div>
      `,
      footer: () => h`<button class="btn btn-subtle" onclick="App.back()">Back to dashboard</button>`,
    };
  },
};

function pinScreen(mode) {
  const isSetup = mode !== 'unlock';
  const screen = {
    content: h`
      <div class="t-body-md t-muted" style="text-align:center;">${isSetup ? 'Set a 4-digit PIN for quick sign-in next time.' : 'Enter your PIN to continue.'}</div>
      <div class="pin-dots">
        ${[0,1,2,3].map(i => h`<div class="pin-dot ${state.pin.length > i ? 'is-filled' : ''}"></div>`).join('')}
      </div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => h`<button class="pin-key" onclick="App.pinPress(${n})">${n}</button>`).join('')}
        <div class="pin-key pin-key--ghost"></div>
        <button class="pin-key" onclick="App.pinPress(0)">0</button>
        <button class="pin-key" onclick="App.pinBackspace()">&#9003;</button>
      </div>
      ${isSetup ? h`<div class="t-body-sm t-caption" style="text-align:center;">Required — this is how you'll sign back in on this device.</div>` : ''}
    `,
  };
  if (!isSetup) {
    screen.footer = () => h`<button class="btn-link" onclick="App.nav(state.pinTarget)">Use Face ID instead</button>`;
  }
  return screen;
}

function gdprScreen(nextRoute, stateKey, pinTargetToSet) {
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
    footer: () => h`<button class="btn btn-primary" ${state[stateKey] ? '' : 'disabled'} onclick="${pinTargetToSet ? `App.set('pinTarget','${pinTargetToSet}'); ` : ''}App.nav('${nextRoute}')">Accept &amp; continue</button>`,
  };
}

function oauthConsentScreen(provider) {
  const p = OAUTH_PROVIDERS[provider];
  const choose = (email) => `App.set('loginMethod','social'); App.set('email','${email}'); App.set('phone','${provider}-account'); App.nav('self-reg-details')`;
  return {
    hideHeader: true,
    content: h`
      <div class="oauth-sheet">
        <div class="oauth-sheet__bar">
          <button class="oauth-sheet__cancel" onclick="App.nav('self-reg-welcome')">Cancel</button>
          <div class="oauth-sheet__url"><span>&#128274;</span> ${p.domain}</div>
          <button class="oauth-sheet__reload" aria-label="Reload">&#8635;</button>
        </div>
        <div class="oauth-sheet__provider">
          <img class="oauth-sheet__provider-icon" src="${p.logo}" alt="" /> Sign in with ${p.label}
        </div>
        <div class="oauth-sheet__body">
          <div class="oauth-sheet__title">Choose an account</div>
          <div class="oauth-sheet__subtitle">to continue to <strong>CtrlChain</strong></div>
          ${p.accounts.map(a => h`
            <div class="oauth-account" onclick="${choose(a.email)}">
              <div class="oauth-account__avatar" style="background:${a.color};">${a.initial}</div>
              <div class="oauth-account__body">
                <div class="oauth-account__name">${a.name}</div>
                <div class="oauth-account__email">${a.email}</div>
              </div>
              ${a.signedOut ? '<div class="oauth-account__status">Signed out</div>' : ''}
            </div>
          `).join('')}
          <div class="oauth-account" onclick="${choose(provider + '.driver@example.com')}">
            <div class="oauth-account__avatar oauth-account__avatar--ghost">&#128100;</div>
            <div class="oauth-account__name">Use another account</div>
          </div>
          <div class="oauth-sheet__disclosure">To continue, ${p.label} will share your ${p.share} with CtrlChain.</div>
        </div>
      </div>
    `,
  };
}

function trackingStatusBanner() {
  if (state.locationPermission === 'always') {
    return h`<div class="tracking-pill tracking-pill--active">&#128205; Automatic tracking active</div>`;
  }
  return h`
    <div class="tracking-pill tracking-pill--limited">
      <span>&#9888; Background tracking limited — arrival won't auto-detect.</span>
      <button type="button" class="tracking-pill__fix" onclick="App.nav('location-priming')">Fix</button>
    </div>
  `;
}

/* ---------------------------------------------------------------- */
/* Render loop */
/* ---------------------------------------------------------------- */

function updateFooterState() {
  const footerEl = document.querySelector('.app-footer');
  const screen = SCREENS[currentRoute()];
  if (footerEl && screen) {
    const rendered = screen();
    if (rendered.footer) footerEl.innerHTML = rendered.footer();
  }
}

function render() {
  const route = currentRoute();
  const screen = SCREENS[route] ? SCREENS[route]() : SCREENS['welcome']();
  const meta = ROUTE_META[route];
  // 'welcome' and 'dashboard' are both parent/home screens — nothing above
  // them to go back to, regardless of how this session happened to arrive.
  const canGoBack = route !== 'welcome' && route !== 'dashboard';

  let headerHtml = '';
  if (!screen.hideHeader) {
    const progressPct = meta ? Math.round((meta.step / meta.total) * 100) : 0;
    headerHtml = h`
      <div class="app-header">
        <div class="app-header__row">
          <button class="app-header__back" onclick="App.back()" ${canGoBack ? '' : 'style="visibility:hidden"'}>&#8592;</button>
          <div class="app-header__title t-headline-md">${TITLES[route] || ''}</div>
          ${meta ? h`<div class="app-header__step t-body-sm">${meta.step} / ${meta.total}</div>` : ''}
        </div>
        ${meta ? h`<div class="app-progress"><div class="app-progress__fill" style="width:${progressPct}%"></div></div>` : ''}
      </div>
    `;
  }

  const footerHtml = screen.footer ? h`<div class="app-footer">${screen.footer()}</div>` : '';

  const statusBar = document.querySelector('.status-bar');
  if (statusBar) statusBar.classList.toggle('status-bar--overlay', !!screen.transparentStatusBar);

  document.getElementById('app').innerHTML = h`
    ${headerHtml}
    <div class="app-content">${screen.content}</div>
    ${footerHtml}
  `;

  document.querySelectorAll('.proto-flow-btn').forEach(btn => {
    btn.classList.toggle('is-active', state.activeFlow === btn.dataset.flow);
  });

  const themeBtn = document.querySelector('.proto-theme-btn');
  if (themeBtn) {
    const isDark = document.documentElement.classList.contains('dark');
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    themeBtn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
