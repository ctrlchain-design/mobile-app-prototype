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

/* Milestone label sets per stop type, matching the target list in the vault's
   product-foundation.md (arrived -> loading/unloading -> departed), each with
   its own timestamp, source (automated/manual), and confirm state. This mirrors
   CtrlChain's real trip model (05-projects/carrier-tms/trip-details.md): a trip
   is a sequence of stops, and a stop can carry one or more customer orders. */
const MILESTONE_LABELS = {
  pickup: ['Arrived at pickup', 'Loading started', 'Loading completed', 'Departed pickup'],
  delivery: ['Arrived at delivery', 'Unloading started', 'Unloading completed', 'Departed delivery'],
};

/* The one trip a driver is actually transporting right now. Modelled as an array
   (see activeTripSection()) so the UI scales to more than one — Samuel's call,
   even though V1 only ever has a single truck / single active trip in practice. */
const MOCK_ACTIVE_TRIPS = [
  {
    id: 'TRIP2026-000123',
    activeStopId: 'STOP-2',
    stops: [
      {
        id: 'STOP-1', type: 'pickup', location: 'Meridian Distribution Centre, Coventry', appointment: 'Today, 08:00',
        orders: [{ id: 'ORD-8841937', ref: 'PO-33210' }],
        milestones: [
          { id: 'm1', label: 'Arrived at pickup', status: 'confirmed', source: 'automated', timestamp: '08:02' },
          { id: 'm2', label: 'Loading started', status: 'confirmed', source: 'manual', timestamp: '08:10' },
          { id: 'm3', label: 'Loading completed', status: 'confirmed', source: 'manual', timestamp: '08:40' },
          { id: 'm4', label: 'Departed pickup', status: 'confirmed', source: 'automated', timestamp: '08:45' },
        ],
        exceptions: [],
      },
      {
        id: 'STOP-2', type: 'delivery', location: 'Aldi RDC, Bristol', appointment: 'Today, 14:30',
        orders: [
          { id: 'ORD-8841937', ref: 'PO-33210', podUploaded: false },
          { id: 'ORD-8841938', ref: 'PO-33211', podUploaded: false },
        ],
        milestones: [
          { id: 'm5', label: 'Arrived at delivery', status: 'proposed', source: 'automated', timestamp: '14:28' },
          { id: 'm6', label: 'Unloading started', status: 'pending', source: null, timestamp: null },
          { id: 'm7', label: 'Unloading completed', status: 'pending', source: null, timestamp: null },
          { id: 'm8', label: 'Departed delivery', status: 'pending', source: null, timestamp: null },
        ],
        exceptions: [],
      },
      {
        id: 'STOP-3', type: 'delivery', location: 'Gloucester Services DC', appointment: 'Tomorrow, 08:00',
        orders: [{ id: 'ORD-8841939', ref: 'PO-33212', podUploaded: false }],
        milestones: [
          { id: 'm9', label: 'Arrived at delivery', status: 'pending', source: null, timestamp: null },
          { id: 'm10', label: 'Unloading started', status: 'pending', source: null, timestamp: null },
          { id: 'm11', label: 'Unloading completed', status: 'pending', source: null, timestamp: null },
          { id: 'm12', label: 'Departed delivery', status: 'pending', source: null, timestamp: null },
        ],
        exceptions: [],
      },
    ],
  },
];

/* Scheduled trips not yet underway — shown collapsed in their own section,
   per Samuel's call that upcoming/scheduled trips get a separate list, not
   a timeline (nothing to act on until they become the active trip). */
const MOCK_UPCOMING_TRIPS = [
  { id: 'TRIP2026-000124', pickup: 'Heathrow Cargo Terminal', dropoff: 'Southampton Docks', status: 'Scheduled', badge: 'warning', eta: 'Tomorrow, 08:00' },
];

const MOCK_GUEST_TRIP = {
  id: 'TRIP2026-000142',
  activeStopId: 'STOP-G2',
  stops: [
    {
      id: 'STOP-G1', type: 'pickup', location: 'Heathrow Cargo Terminal', appointment: 'Today, 13:00',
      orders: [{ id: 'ORD-9001', ref: 'GT-142' }],
      milestones: [
        { id: 'g1', label: 'Arrived at pickup', status: 'confirmed', source: 'automated', timestamp: '13:04' },
        { id: 'g2', label: 'Loading started', status: 'confirmed', source: 'manual', timestamp: '13:10' },
        { id: 'g3', label: 'Loading completed', status: 'confirmed', source: 'manual', timestamp: '13:30' },
        { id: 'g4', label: 'Departed pickup', status: 'confirmed', source: 'automated', timestamp: '13:35' },
      ],
      exceptions: [],
    },
    {
      id: 'STOP-G2', type: 'delivery', location: 'Southampton Docks', appointment: 'Today, 16:00',
      orders: [{ id: 'ORD-9001', ref: 'GT-142', podUploaded: false }],
      milestones: [
        { id: 'g5', label: 'Arrived at delivery', status: 'proposed', source: 'automated', timestamp: '15:58' },
        { id: 'g6', label: 'Unloading started', status: 'pending', source: null, timestamp: null },
        { id: 'g7', label: 'Unloading completed', status: 'pending', source: null, timestamp: null },
        { id: 'g8', label: 'Departed delivery', status: 'pending', source: null, timestamp: null },
      ],
      exceptions: [],
    },
  ],
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* 8 digits, not 6 — backend preference, harder to brute-force than a 6-digit code. */
const MOCK_ACTIVATION_CODE = '48213976';

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
  // portal-sms and portal-install both happen before the driver has the app
  // open at all (a text message, then either the App Store or manually
  // switching to an already-installed app) — neither is a real numbered step
  // in CtrlChain's own onboarding, so neither gets progress-bar chrome.
  'portal-sms': null,
  'portal-install': null,
  'portal-code': { flow: 'portal', step: 1, total: 5 },
  'portal-confirm': { flow: 'portal', step: 2, total: 5 },
  'portal-pin': { flow: 'portal', step: 3, total: 5 },
  'portal-gdpr': { flow: 'portal', step: 4, total: 5 },
  'portal-complete': { flow: 'portal', step: 5, total: 5 },
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
    locationPermission: null, // null | 'always' | 'while-using' | 'denied'

    // Mutable copies — the driver confirms milestones, edits timestamps, and
    // uploads PODs against these, never against the MOCK_* constants directly.
    activeTrips: deepClone(MOCK_ACTIVE_TRIPS),
    guestTrip: deepClone(MOCK_GUEST_TRIP),

    // Dashboard UI-only state (expand/collapse, open modals) — not part of the
    // trip data itself, reset on every restart along with everything else.
    stopExpandOverride: {}, // stopId/tripId -> boolean, overrides the default (active stop open)
    editingMilestone: null, // { stopId, milestoneId } | null — which timestamp is mid-edit
    podSheet: null,         // { tripId, stopId, orderId } | null
    exceptionSheet: null,   // { tripId, stopId } | null
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
    html.classList.remove('light', 'dark', 'sl-theme-light', 'sl-theme-dark');
    html.classList.add(goingDark ? 'dark' : 'light', goingDark ? 'sl-theme-dark' : 'sl-theme-light');
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

  toggleExpand(id, current) {
    state.stopExpandOverride[id] = !current;
    render();
  },

  confirmMilestone(tripId, stopId, milestoneId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const m = stop && stop.milestones.find(x => x.id === milestoneId);
    if (m) m.status = 'confirmed';
    render();
  },

  startEditTimestamp(stopId, milestoneId) {
    state.editingMilestone = { stopId, milestoneId };
    render();
  },

  cancelEditTimestamp() {
    state.editingMilestone = null;
    render();
  },

  saveTimestamp(tripId, stopId, milestoneId) {
    const input = document.getElementById(`ts-input-${milestoneId}`);
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const m = stop && stop.milestones.find(x => x.id === milestoneId);
    if (m && input) m.timestamp = input.value || m.timestamp;
    state.editingMilestone = null;
    render();
  },

  openPodSheet(tripId, stopId, orderId) {
    state.podSheet = { tripId, stopId, orderId };
    render();
  },

  closePodSheet() {
    state.podSheet = null;
    render();
  },

  submitPod() {
    const { tripId, stopId, orderId } = state.podSheet;
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order) order.podUploaded = true;
    state.podSheet = null;
    render();
  },

  openExceptionSheet(tripId, stopId) {
    state.exceptionSheet = { tripId, stopId };
    render();
  },

  closeExceptionSheet() {
    state.exceptionSheet = null;
    render();
  },

  submitException() {
    const { tripId, stopId } = state.exceptionSheet;
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const typeEl = document.getElementById('exception-type');
    const orderEl = document.getElementById('exception-order');
    const descEl = document.getElementById('exception-description');
    if (stop) {
      const typeValue = typeEl ? typeEl.value : EXCEPTION_TYPES[0].value;
      const typeLabel = (EXCEPTION_TYPES.find(t => t.value === typeValue) || EXCEPTION_TYPES[0]).label;
      stop.exceptions.push({
        type: typeLabel,
        orderId: orderEl && orderEl.value !== '__all' ? orderEl.value : null,
        description: descEl ? descEl.value : '',
      });
    }
    state.exceptionSheet = null;
    render();
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

/* Compact row for a trip that isn't underway yet — Scheduled/Upcoming section
   only. Nothing to act on until it becomes the active trip, so it isn't tappable. */
function tripCard(trip) {
  return h`
    <div class="card trip-card">
      <div class="trip-card__top">
        <span class="t-label-md">${trip.id}</span>
        <span class="badge badge--${trip.badge}">${trip.status}</span>
      </div>
      <div class="t-body-sm t-muted">${trip.pickup} &#8594; ${trip.dropoff}</div>
      <div class="t-body-sm t-caption">ETA ${trip.eta}</div>
    </div>
  `;
}

/* Time-of-day greeting for the dashboard header — small touch, but it's the
   difference between "Welcome" (a system talking) and a driver feeling checked-in on. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/* Whether a given <sl-details> (a stop card, or the trip accordion itself) should
   render open. Defaults to "the active stop / the trip itself" is open; anything
   the driver has manually toggled is remembered in state.stopExpandOverride so a
   later re-render (e.g. confirming a milestone elsewhere) doesn't silently re-collapse
   something they opened themselves — full re-renders replace the DOM every time,
   so this can't rely on <sl-details> tracking its own open state across renders. */
function isExpanded(id, defaultOpen) {
  return id in state.stopExpandOverride ? state.stopExpandOverride[id] : defaultOpen;
}

function findActiveTrip(tripId) {
  return state.activeTrips.find(t => t.id === tripId) || (state.guestTrip.id === tripId ? state.guestTrip : null);
}

function findStop(trip, stopId) {
  return trip.stops.find(s => s.id === stopId);
}

/* One or more "Active Trip" accordions — the dashboard's main content. Each is
   its own <sl-details>, open by default (see isExpanded above), so a driver can
   collapse a trip to get it out of the way without losing anything else on the
   dashboard. Takes an array so this scales past one truck/trip, even though V1
   never actually has more than one active at a time. */
function activeTripSection(trips) {
  return trips.map(trip => h`
    <sl-details class="active-trip" ${isExpanded(trip.id, true) ? 'open' : ''} onclick="if(event.target.closest('[data-role=summary]')) App.toggleExpand('${trip.id}', ${isExpanded(trip.id, true)})">
      <div slot="summary" data-role="summary" class="active-trip__summary">
        <div class="active-trip__summary-top">
          <span class="t-label-md">${trip.id}</span>
          <span class="badge badge--info">In progress</span>
        </div>
        <span class="t-body-sm t-caption">${trip.stops.length} stops &middot; ${trip.stops.reduce((n, s) => n + s.orders.length, 0)} orders</span>
      </div>
      <div class="active-trip__timeline">${stopTimelineList(trip)}</div>
    </sl-details>
  `).join('');
}

/* Current stop pinned to the top (not chronological-from-start), everything
   else following in actual route order below — scroll to reach any other
   stop, past or future, non-sequentially. */
function stopTimelineList(trip) {
  const active = findStop(trip, trip.activeStopId);
  const rest = trip.stops.filter(s => s.id !== trip.activeStopId);
  const ordered = active ? [active, ...rest] : trip.stops;
  return h`<div class="stop-list">${ordered.map(stop => stopItem(trip, stop)).join('')}</div>`;
}

function stopStatus(stop) {
  if (stop.milestones.every(m => m.status === 'confirmed')) return 'completed';
  if (stop.milestones.some(m => m.status !== 'pending')) return 'active';
  return 'upcoming';
}

function stopItem(trip, stop) {
  const status = stopStatus(stop);
  const isActive = stop.id === trip.activeStopId;
  const expanded = isExpanded(stop.id, isActive);
  const orderCount = stop.orders.length;
  return h`
    <div class="stop-item stop-item--${status}">
      <div class="stop-card">
        <sl-details ${expanded ? 'open' : ''} onclick="if(event.target.closest('[data-role=summary]')) App.toggleExpand('${stop.id}', ${expanded})">
          <div slot="summary" data-role="summary" class="stop-summary">
            <div>
              <div class="stop-summary__title">
                <span class="t-label-md">${stop.type === 'pickup' ? 'Pickup' : 'Delivery'} &middot; ${stop.location}</span>
                ${stop.exceptions.length ? h`<span class="exception-flag" title="Exception reported">&#9888;</span>` : ''}
              </div>
              <div class="stop-summary__meta">
                <span class="t-body-sm t-caption">${stop.appointment}</span>
                ${orderCount > 1 ? h`<span class="badge badge--info">${orderCount} orders</span>` : ''}
              </div>
            </div>
          </div>
          <div class="stop-body">
            ${stop.milestones.map(m => milestoneRow(trip, stop, m)).join('')}
            ${stop.type === 'delivery' ? h`<div class="dash-section" style="gap:6px;">${stop.orders.map(o => orderRow(trip, stop, o)).join('')}</div>` : ''}
            <div class="stop-actions">
              <button type="button" class="btn btn-subtle" style="width:auto; flex:1;" onclick="App.openExceptionSheet('${trip.id}','${stop.id}')">&#9888; Report exception</button>
            </div>
          </div>
        </sl-details>
      </div>
    </div>
  `;
}

function milestoneRow(trip, stop, m) {
  const editing = state.editingMilestone && state.editingMilestone.milestoneId === m.id;
  if (editing) {
    return h`
      <div class="milestone-row">
        <div class="milestone-row__main">
          <span class="t-body-md">${m.label}</span>
          <div class="timestamp-edit">
            <sl-input id="ts-input-${m.id}" type="time" size="small" value="${m.timestamp || ''}"></sl-input>
            <sl-button size="small" variant="primary" onclick="App.saveTimestamp('${trip.id}','${stop.id}','${m.id}')">Save</sl-button>
            <sl-button size="small" variant="default" onclick="App.cancelEditTimestamp()">Cancel</sl-button>
          </div>
        </div>
      </div>
    `;
  }
  const sourceLabel = m.source === 'automated' ? 'Automated' : m.source === 'manual' ? 'Manual' : '';
  return h`
    <div class="milestone-row milestone-row--${m.status}">
      <div class="milestone-row__main">
        <div class="milestone-row__label-line">
          <span class="t-body-md">${m.label}</span>
          ${m.status === 'proposed' ? h`<span class="badge badge--warning">Awaiting confirm</span>` : ''}
        </div>
        <span class="t-body-sm t-caption">
          ${m.timestamp
            ? h`${sourceLabel ? sourceLabel + ' &middot; ' : ''}<button type="button" class="timestamp-btn" onclick="App.startEditTimestamp('${stop.id}','${m.id}')">${m.timestamp}</button>`
            : 'Not yet reached'}
        </span>
      </div>
      ${m.status === 'proposed' ? h`
        <div class="milestone-row__actions">
          <sl-button size="small" variant="primary" onclick="App.confirmMilestone('${trip.id}','${stop.id}','${m.id}')">Confirm</sl-button>
        </div>
      ` : m.status === 'confirmed' ? h`<div class="milestone-row__actions"><span class="t-label-sm" style="color:var(--success-text);">&#10003;</span></div>` : ''}
    </div>
  `;
}

function orderRow(trip, stop, order) {
  return h`
    <div class="order-row">
      <div class="order-row__label">
        <span class="t-body-sm t-label-md">${order.ref}</span>
        <span class="t-body-sm t-caption">${order.podUploaded ? 'POD uploaded' : 'POD not yet uploaded'}</span>
      </div>
      ${order.podUploaded
        ? h`<span class="badge badge--success">&#10003; Done</span>`
        : h`<sl-button size="small" onclick="App.openPodSheet('${trip.id}','${stop.id}','${order.id}')">Upload POD</sl-button>`}
    </div>
  `;
}

/* POD upload — real modal sheet (bottom drawer), per order at a delivery stop.
   Matches what's actually built today (mobile-app-status.md): a mandatory POD
   document plus an optional cargo photo — no signature/notes fields exist yet,
   so none are invented here. */
function podSheetMarkup() {
  const open = !!state.podSheet;
  let order = null, stop = null;
  if (open) {
    const trip = findActiveTrip(state.podSheet.tripId);
    stop = trip && findStop(trip, state.podSheet.stopId);
    order = stop && stop.orders.find(o => o.id === state.podSheet.orderId);
  }
  return h`
    <sl-drawer id="pod-drawer" label="Upload POD" placement="bottom" ${open ? 'open' : ''} onsl-request-close="App.closePodSheet()">
      ${open ? h`
        <div class="sheet-body">
          <div class="t-body-sm t-muted">${order.ref} &middot; ${stop.location}</div>
          <div class="sheet-field">
            <label class="t-label-sm">POD document <span class="t-caption">(required)</span></label>
            <input type="file" accept="image/*,.pdf" capture="environment" />
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Cargo photo <span class="t-caption">(optional)</span></label>
            <input type="file" accept="image/*" capture="environment" />
          </div>
        </div>
        <div slot="footer" style="display:flex; gap:8px;">
          <sl-button style="flex:1;" onclick="App.closePodSheet()">Cancel</sl-button>
          <sl-button style="flex:1;" variant="primary" onclick="App.submitPod()">Submit POD</sl-button>
        </div>
      ` : ''}
    </sl-drawer>
  `;
}

/* Exception reporting — real modal sheet, originated for this design since no
   structured flow exists anywhere yet (today it's phone-call-only). Fields
   chosen to match the V1 "structured exception capture" goal from the kickoff:
   a type, which order it affects (only asked when the stop has more than one),
   a description, and optional photo evidence. */
/* sl-option values can't contain spaces (Shoelace silently mangles them) — slug
   for the value, human label for the visible text and the stored record. */
const EXCEPTION_TYPES = [
  { value: 'delay', label: 'Delay' },
  { value: 'damaged-goods', label: 'Damaged goods' },
  { value: 'missing-items', label: 'Missing items' },
  { value: 'site-access', label: 'Site access issue' },
  { value: 'vehicle-issue', label: 'Vehicle issue' },
  { value: 'other', label: 'Other' },
];

function exceptionSheetMarkup() {
  const open = !!state.exceptionSheet;
  let stop = null;
  if (open) {
    const trip = findActiveTrip(state.exceptionSheet.tripId);
    stop = trip && findStop(trip, state.exceptionSheet.stopId);
  }
  return h`
    <sl-drawer id="exception-drawer" label="Report exception" placement="bottom" ${open ? 'open' : ''} onsl-request-close="App.closeExceptionSheet()">
      ${open ? h`
        <div class="sheet-body">
          <div class="t-body-sm t-muted">${stop.location}</div>
          <div class="sheet-field">
            <label class="t-label-sm">Type</label>
            <sl-select id="exception-type">
              ${EXCEPTION_TYPES.map(t => h`<sl-option value="${t.value}">${t.label}</sl-option>`).join('')}
            </sl-select>
          </div>
          ${stop.orders.length > 1 ? h`
            <div class="sheet-field">
              <label class="t-label-sm">Affected order</label>
              <sl-select id="exception-order" value="__all">
                <sl-option value="__all">Whole stop</sl-option>
                ${stop.orders.map(o => h`<sl-option value="${o.id}">${o.ref}</sl-option>`).join('')}
              </sl-select>
            </div>
          ` : ''}
          <div class="sheet-field">
            <label class="t-label-sm">Description</label>
            <sl-textarea id="exception-description" rows="3" placeholder="What happened?"></sl-textarea>
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Photo evidence <span class="t-caption">(optional)</span></label>
            <input type="file" accept="image/*" capture="environment" />
          </div>
        </div>
        <div slot="footer" style="display:flex; gap:8px;">
          <sl-button style="flex:1;" onclick="App.closeExceptionSheet()">Cancel</sl-button>
          <sl-button style="flex:1;" variant="primary" onclick="App.submitException()">Submit</sl-button>
        </div>
      ` : ''}
    </sl-drawer>
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

  'portal-sms': () => messagesAppScreen({
    sender: 'CtrlChain',
    body: h`You've been added as a driver by <strong>${MOCK_PLANNER_RECORD.carrier}</strong> on CtrlChain. Your activation code: <strong>${MOCK_ACTIVATION_CODE}</strong><br/>`,
    link: 'app.ctrlchain.com/invite/8f2a1c&hellip;',
    onLinkTap: "App.nav('portal-install')",
    note: "Prototype: tap the link above to continue. (Token is hashed, single-use, ~10-15 min validity.)",
  }),

  // A plain app-store link, sent separately from the code — no deferred
  // deep-linking dependency. This happens before the driver has CtrlChain
  // open at all, so it can't be one of our own numbered in-app screens; it's
  // styled to read as the App Store, not as step 2 of onboarding. Either path
  // (install, or already have it) ends at the same place: portal-code, the
  // app's real first screen once actually opened.
  'portal-install': () => ({
    hideHeader: true,
    content: h`
      <div class="appstore-mock">
        <div class="appstore-mock__nav">&#8249; App Store</div>
        <div class="appstore-mock__card">
          <div class="appstore-mock__icon"><img src="assets/logo-icon.svg" alt="" /></div>
          <div class="appstore-mock__title">CtrlChain Driver</div>
          <div class="appstore-mock__subtitle">Business</div>
          <button type="button" class="appstore-mock__get" onclick="App.nav('portal-code')">GET</button>
        </div>
        <div class="appstore-mock__caption">A plain app-store link is sent separately from the code — no deferred deep-linking dependency.</div>
      </div>
    `,
    footer: () => h`<div class="messages-mock__note">Prototype: tap GET to simulate installing and opening the app. Already installed? <a class="btn-link" onclick="App.nav('portal-code')">Skip straight to the app</a>.</div>`,
  }),

  'portal-code': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the 8-digit activation code from the SMS.</div>
      <div class="otp-row otp-row--compact">
        ${[0,1,2,3,4,5,6,7].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'portalCode')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <div class="t-body-sm t-caption">Demo: any 8 digits will work.</div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.portalCode.length === 8 ? '' : 'disabled'} onclick="App.nav('portal-confirm')">Continue</button>`,
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
      // The 8-digit activation code (portal-code) already proved the driver
      // holds this phone number — a second OTP here would just re-check the
      // same channel. Straight to PIN setup for both first-time and
      // reactivating drivers.
      footer: () => h`<button class="btn btn-primary" onclick="App.set('pinTarget','portal-gdpr'); App.nav('portal-pin')">This is me — continue</button>`,
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

  'guest-sms': () => messagesAppScreen({
    sender: 'CtrlChain',
    body: h`You've been given temporary access to <strong>Trip ${MOCK_GUEST_TRIP.id}</strong> by <strong>${MOCK_PLANNER_RECORD.carrier}</strong>.<br/>`,
    link: `app.ctrlchain.com/trip/${MOCK_GUEST_TRIP.id}?t=e91a&hellip;`,
    onLinkTap: "App.nav('guest-trust')",
    note: "Prototype: tap the link above to continue. (Hashed, single-use token, ~10-15 min validity — app-store link sent separately if not yet installed.)",
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
        <div class="card trip-card" style="text-align:left; width:100%;">
          <div class="trip-card__top"><span class="t-label-md">${MOCK_GUEST_TRIP.id}</span></div>
          <div class="t-body-sm t-muted">${MOCK_GUEST_TRIP.stops[0].location} &#8594; ${MOCK_GUEST_TRIP.stops[MOCK_GUEST_TRIP.stops.length - 1].location}</div>
        </div>
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
          <div class="dash-header">
            <div class="t-headline-md">${greeting()}</div>
            <span class="badge badge--info">Guest access — this trip only</span>
          </div>
          ${trackingStatusBanner()}
          ${activeTripSection([state.guestTrip])}
          <div class="card">
            <div class="t-body-sm t-muted">This access ends automatically once the trip is marked complete — nothing to clean up.</div>
          </div>
          ${podSheetMarkup()}
          ${exceptionSheetMarkup()}
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
        <div class="dash-header">
          <div class="t-headline-md">${greeting()}, ${name.split(' ')[0] || 'driver'}</div>
          <div class="t-body-sm t-muted">${carrier} &middot; Full trip visibility</div>
        </div>
        ${trackingStatusBanner()}
        <div class="dash-section">
          <div class="t-label-sm t-caption dash-section__label">ACTIVE TRIP</div>
          ${activeTripSection(state.activeTrips)}
        </div>
        <div class="dash-section">
          <div class="dash-section__row">
            <span class="t-label-sm t-caption dash-section__label">SCHEDULED</span>
            <span class="t-caption">${MOCK_UPCOMING_TRIPS.length ? `${MOCK_UPCOMING_TRIPS.length} trip${MOCK_UPCOMING_TRIPS.length > 1 ? 's' : ''}` : ''}</span>
          </div>
          ${MOCK_UPCOMING_TRIPS.length
            ? MOCK_UPCOMING_TRIPS.map(t => tripCard(t)).join('')
            : h`<div class="t-body-sm t-caption dash-empty-note">Nothing scheduled beyond the active trip.</div>`}
        </div>
        ${podSheetMarkup()}
        ${exceptionSheetMarkup()}
      `,
      footer: () => h`<button class="btn btn-subtle" onclick="App.restartFlow()">Restart this flow</button>`,
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

/* Mocks the phone's native Messages app — deliberately breaks from CCA's own
   UI (no header, no brand colors) so reviewers don't mistake "a text message
   arrives" for an in-app screen. Tapping the link (or the whole bubble, for
   forgiveness) is the only interactive element; the rest is inert chrome. */
function messagesAppScreen({ sender, body, link, onLinkTap, note }) {
  return {
    hideHeader: true,
    content: h`
      <div class="messages-mock">
        <div class="messages-mock__bar">
          <span class="messages-mock__back">&#8249; Messages</span>
          <span class="messages-mock__contact">${sender}</span>
          <span class="messages-mock__icon">&#9432;</span>
        </div>
        <div class="messages-mock__body">
          <div class="messages-mock__timestamp">Today 9:41</div>
          <div class="messages-mock__bubble" onclick="${onLinkTap}">
            ${body}
            <a class="messages-mock__link">${link}</a>
          </div>
        </div>
      </div>
    `,
    footer: () => h`<div class="messages-mock__note">${note}</div>`,
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
