import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView, useKeplerBackHandler} from '@amazon-devices/react-native-kepler';
import {fetchDefaults, fetchPlan} from './api';
import {Icon, type IconName} from './icons';
import {applianceLabel, colors, motion, radius, spacing, type} from './theme';
import type {Alternative, ApplianceRequirement, Defaults, Plan} from './types';

type Page = 'overview' | 'editAppliance' | 'editBattery' | 'alternatives';

const OUTAGE_HOURS = 12;
const APPLIANCE_IDS = ['fridge', 'router', 'lamp', 'phone', 'laptop', 'fan'];
const DEFAULT_CRITICAL_IDS = new Set(['fridge', 'router']);

// "Essential" here is a household preference the optimizer respects --
// it is not a safety certification. Fridge and router are the two
// appliances where that distinction actually matters in the real world
// (food safety, emergency connectivity), so unmarking either one gets an
// explicit, appliance-specific caution instead of the generic toggle
// copy every other appliance gets. This is deliberately narrow: nothing
// else in the UI changes for the other four appliances.
const SAFETY_SENSITIVE_IDS = new Set(['fridge', 'router']);
const SAFETY_NOTE: Record<string, string> = {
  fridge:
    'Unmarking fridge is your own choice. A plan shown as feasible is a math-only energy estimate -- ' +
    'it is not a guarantee that food stays safely cold for that long.',
  router:
    'Unmarking router is your own choice. A plan shown as feasible is a math-only energy estimate -- ' +
    'it is not a guarantee of connectivity if you need it.',
};

function essentialNoteFor(id: string, isCritical: boolean): string {
  if (isCritical) {
    if (id === 'fridge') {
      return 'Marked essential: protects food safety. The automatic repair search won\'t reduce it unless no other fix exists.';
    }
    if (id === 'router') {
      return 'Marked essential: keeps emergency connectivity available. The automatic repair search won\'t reduce it unless no other fix exists.';
    }
    return "Marked essential: the automatic repair search won't reduce it unless no other fix exists.";
  }
  return 'Not marked essential: the automatic repair search may reduce it freely to make a plan fit.';
}

// Same caution as SAFETY_NOTE above, phrased for an alternative-repair
// card rather than the edit screen -- shown whenever a specific repair
// would actually reduce fridge or router's hours, regardless of which
// tier it's tagged (a repair can be "protects_essentials" and still
// touch fridge, if the household has unmarked fridge itself).
function alternativeSafetyCaution(changedIds: string[]): string | null {
  const touches = changedIds.filter(id => SAFETY_SENSITIVE_IDS.has(id));
  if (touches.length === 0) {
    return null;
  }
  const concerns = touches
    .map(id => (id === 'fridge' ? 'food safety' : 'connectivity'))
    .join(' and ');
  return (
    `Verified against the energy math only -- not a guarantee of ${concerns}.`
  );
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

// Every focusable card/button in the app renders its visual body through
// this wrapper so TV remote focus reads consistently everywhere: a small,
// quick scale-up plus the caller's own focused styling (border/background
// color), never scale alone. useNativeDriver is safe here -- transform and
// opacity are the two style properties RN's native driver always supports,
// and this is the only animation in the app, so a failure mode is easy to
// reason about and does not touch any layout-affecting property.
function FocusTile({
  focused,
  style,
  children,
}: {
  focused: boolean;
  style?: object | Array<object | false | undefined>;
  children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    // Jest's test renderer has no real frame clock, so a running
    // Animated.timing there only produces "not wrapped in act()" noise
    // long after a test finishes, never a visible effect. Snap instead of
    // animating under test; real devices always take the animated path.
    if (typeof jest !== 'undefined') {
      scale.setValue(focused ? motion.focusScale : 1);
      return;
    }
    Animated.timing(scale, {
      toValue: focused ? motion.focusScale : 1,
      duration: motion.duration,
      useNativeDriver: true,
    }).start();
  }, [focused, scale]);
  return <Animated.View style={[style, {transform: [{scale}]}]}>{children}</Animated.View>;
}

export const App = () => {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [appliances, setAppliances] = useState<ApplianceRequirement[]>([]);
  const [usableWh, setUsableWh] = useState(1800);
  const [maxW, setMaxW] = useState(200);
  // Which appliances this household currently marks essential. Seeded from
  // the defaults' fridge/router pair, but from here on is purely local UI
  // state the household controls (Phase B) -- every recompute() sends it
  // to the engine, which is what actually makes the selection change which
  // repairs get found, not just which badges get drawn.
  const [criticalIds, setCriticalIds] = useState<Set<string>>(DEFAULT_CRITICAL_IDS);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('overview');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focus, setFocus] = useState('fridge');
  const busy = useRef(false);
  const backHandler = useKeplerBackHandler();
  const alternativesScrollRef = useRef<ScrollView>(null);

  // TV focus engines scroll a focused element fully into view -- the
  // alternatives screen's first card has hasTVPreferredFocus, and with the
  // safety-caution text (Phase B) making a card taller, that auto-scroll
  // was clipping the "Why this doesn't fit" heading above it on first
  // entry. The fix is to explicitly re-scroll to the top right after that
  // auto-scroll happens, rather than changing any layout or sizing.
  useEffect(() => {
    if (page === 'alternatives') {
      const id = setTimeout(() => {
        alternativesScrollRef.current?.scrollTo({y: 0, animated: false});
      }, 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [page]);

  const recompute = useCallback(
    async (
      nextAppliances: ApplianceRequirement[],
      nextUsableWh: number,
      nextMaxW: number,
      nextCriticalIds: Set<string>,
    ) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPlan(nextUsableWh, nextMaxW, nextAppliances, [...nextCriticalIds]);
        setPlan(data);
        setAppliances(nextAppliances);
        setUsableWh(nextUsableWh);
        setMaxW(nextMaxW);
        setCriticalIds(nextCriticalIds);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
        busy.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const d = await fetchDefaults();
        setDefaults(d);
        const initial = d.appliances.map(a => ({id: a.id, required_hours: a.required_hours}));
        await recompute(initial, d.usable_wh, d.max_w, DEFAULT_CRITICAL_IDS);
      } catch (e) {
        setError(String(e));
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subscription = backHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'overview') {
        setPage('overview');
        setEditingId(null);
        return true;
      }
      return false;
    });
    return () => subscription?.remove();
  }, [backHandler, page]);

  const applianceInfo = defaults?.appliances.reduce<Record<string, Defaults['appliances'][number]>>(
    (acc, a) => ({...acc, [a.id]: a}),
    {},
  );

  function hoursFor(id: string) {
    return appliances.find(a => a.id === id)?.required_hours ?? 0;
  }

  // Every button that triggers a recompute is routed through here. While a
  // request is in flight, further presses are ignored rather than silently
  // queued or allowed to race -- the "Saving…" indicator shown on every
  // screen makes that state visible instead of leaving a press to appear to
  // do nothing. Navigation-only presses (opening/leaving a screen) are not
  // guarded, since they don't touch engine state.
  function guard(action: () => void) {
    return () => {
      if (!loading) {
        action();
      }
    };
  }

  function setApplianceHours(id: string, hours: number) {
    const info = applianceInfo?.[id];
    const bounded = clamp(hours, 0, OUTAGE_HOURS);
    const next = appliances.map(a => (a.id === id ? {...a, required_hours: bounded} : a));
    recompute(next, usableWh, maxW, criticalIds);
    return info;
  }

  function setBattery(nextUsableWh: number, nextMaxW: number) {
    recompute(
      appliances,
      clamp(nextUsableWh, 100, 10000),
      clamp(nextMaxW, 50, 2000),
      criticalIds,
    );
  }

  function resetToDefault() {
    if (!defaults) {
      return;
    }
    const initial = defaults.appliances.map(a => ({id: a.id, required_hours: a.required_hours}));
    recompute(initial, defaults.usable_wh, defaults.max_w, DEFAULT_CRITICAL_IDS);
  }

  function applyAlternative(alt: Alternative) {
    const next = appliances.map(a => {
      const change = alt.changed.find(c => c.id === a.id);
      return change ? {...a, required_hours: change.to_hours} : a;
    });
    recompute(next, usableWh, maxW, criticalIds);
    setPage('overview');
  }

  // Toggling an appliance's essential status is a household choice, not a
  // navigation action -- routed through recompute() like every other edit,
  // so the in-flight guard and "Saving…" indicator cover it the same way,
  // and the new selection is sent to the engine on the very next call
  // (never just toggled in local display state and left stale).
  function toggleEssential(id: string) {
    const next = new Set(criticalIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    recompute(appliances, usableWh, maxW, next);
  }

  function renderStatusLine() {
    if (!error && !loading) {
      return null;
    }
    return (
      <Text
        style={error ? styles.errorText : styles.loadingText}
        testID={error ? 'status-error' : 'status-loading'}>
        {error ? 'Calculation error: ' + error : 'Saving…'}
      </Text>
    );
  }

  const feasible = plan?.requested.result.feasible ?? null;
  const requestedWh = plan?.requested.requested_wh ?? 0;
  const budgetWh = plan?.budget_wh ?? usableWh;
  const energyRatio = budgetWh > 0 ? requestedWh / budgetWh : 0;
  const deltaWh = requestedWh - budgetWh;

  // ---------------- Overview ----------------
  function renderOverview() {
    return (
      <View style={styles.screen} testID="screen-overview">
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.wordmark}>PowerCut</Text>
            <Text style={styles.subtitle}>{plan?.title ?? "Tonight's outage plan"} · {OUTAGE_HOURS}h window</Text>
          </View>
          {feasible !== null && (
            <View
              style={[
                styles.statusBadge,
                {backgroundColor: feasible ? colors.feasibleDim : colors.infeasibleDim},
              ]}
              testID="status-badge">
              <View
                style={[styles.statusDot, {backgroundColor: feasible ? colors.feasible : colors.infeasible}]}
              />
              <Text style={[styles.statusText, {color: feasible ? colors.feasible : colors.infeasible}]}>
                {feasible ? 'FEASIBLE' : 'INFEASIBLE'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.heroPanel}>
          <View style={styles.heroMain}>
            <Text style={styles.heroLabel}>Energy needed tonight</Text>
            <View style={styles.heroNumberRow}>
              <Text
                style={[
                  styles.heroNumber,
                  {color: energyRatio > 1 ? colors.infeasible : colors.text},
                ]}>
                {requestedWh}
              </Text>
              <Text style={styles.heroNumberUnit}> of {budgetWh} Wh available</Text>
            </View>
            <View style={styles.energyTrack}>
              <View
                style={[
                  styles.energyFill,
                  {
                    width: `${clamp(energyRatio * 100, 2, 100)}%`,
                    backgroundColor: energyRatio > 1 ? colors.infeasible : colors.feasible,
                  },
                ]}
              />
              <View style={styles.energyTrackMarker} />
            </View>
            {renderStatusLine()}
          </View>
          {plan && (
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{deltaWh > 0 ? 'Shortfall' : 'Remaining'}</Text>
              <Text
                style={[
                  styles.heroStatValue,
                  {color: deltaWh > 0 ? colors.infeasible : colors.feasible},
                ]}>
                {Math.abs(deltaWh)} <Text style={styles.heroStatUnit}>Wh</Text>
              </Text>
              <Text style={styles.heroStatCaption}>
                {deltaWh > 0 ? 'over budget' : 'left in the battery'}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionLabel}>Appliances · {OUTAGE_HOURS}h outage</Text>
        <TVFocusGuideView style={styles.applianceRow} autoFocus>
          {APPLIANCE_IDS.map((id, i) => {
            const info = applianceInfo?.[id];
            const isCritical = criticalIds.has(id);
            const wasReduced = plan?.requested.critical_reduced.includes(id);
            const windowLen = info ? new Set(info.allowed_hours).size : OUTAGE_HOURS;
            const hoursRatio = windowLen > 0 ? clamp(hoursFor(id) / windowLen, 0, 1) : 0;
            return (
              <Pressable
                key={id}
                testID={`tile-appliance-${id}`}
                hasTVPreferredFocus={i === 0}
                accessibilityLabel={
                  `${applianceLabel[id]}, ${hoursFor(id)} hours` +
                  (isCritical ? ', essential service' : '') +
                  (wasReduced ? ', reduced below full' : '')
                }
                onFocus={() => setFocus(id)}
                onPress={() => {
                  setEditingId(id);
                  setPage('editAppliance');
                }}
                style={styles.applianceSlot}>
                <FocusTile
                  focused={focus === id}
                  style={[
                    styles.applianceCard,
                    isCritical && styles.applianceCardCritical,
                    focus === id && styles.cardFocused,
                  ]}>
                  {isCritical ? (
                    <View
                      style={[
                        styles.essentialPill,
                        {backgroundColor: wasReduced ? colors.infeasibleDim : colors.accentSoft},
                      ]}>
                      <Text
                        testID={`badge-essential-${id}`}
                        style={[
                          styles.essentialPillText,
                          {color: wasReduced ? colors.infeasible : colors.accent},
                        ]}>
                        {wasReduced ? '⚠ essential' : '✓ essential'}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.essentialPillSpacer} />
                  )}
                  <Icon name={id as IconName} size={24} color={colors.text} />
                  <Text style={styles.applianceName}>{applianceLabel[id]}</Text>
                  <Text style={styles.applianceHours}>{hoursFor(id)}h</Text>
                  <View style={styles.miniTrack}>
                    <View style={[styles.miniFill, {width: `${hoursRatio * 100}%`}]} />
                  </View>
                  {info && <Text style={styles.applianceWatts}>{info.low_w}-{info.high_w} W</Text>}
                </FocusTile>
              </Pressable>
            );
          })}
        </TVFocusGuideView>

        <TVFocusGuideView style={styles.actionRow}>
          <Pressable
            testID="tile-battery"
            accessibilityLabel={`Battery, ${usableWh} watt hours, ${maxW} watt limit`}
            onFocus={() => setFocus('battery')}
            onPress={() => setPage('editBattery')}
            style={styles.actionSlot}>
            <FocusTile focused={focus === 'battery'} style={[styles.actionCard, focus === 'battery' && styles.cardFocused]}>
              <Icon name="battery" size={30} color={colors.text} />
              <View style={styles.actionTextGroup}>
                <Text style={styles.actionTitle} numberOfLines={1}>Battery</Text>
                <Text style={styles.actionValue} numberOfLines={1}>{usableWh} Wh · {maxW} W limit</Text>
              </View>
            </FocusTile>
          </Pressable>
          {feasible === false && (
            <Pressable
              testID="tile-alternatives"
              accessibilityLabel="View conflict and alternatives"
              onFocus={() => setFocus('alternatives')}
              onPress={() => setPage('alternatives')}
              style={styles.actionSlot}>
              <FocusTile
                focused={focus === 'alternatives'}
                style={[styles.actionCard, styles.actionCardAlert, focus === 'alternatives' && styles.cardFocused]}>
                <Icon name="warning" size={28} color={colors.infeasible} />
                <View style={styles.actionTextGroup}>
                  <Text style={styles.actionTitle} numberOfLines={1}>Why this doesn't fit</Text>
                  <Text style={[styles.actionValue, {color: colors.infeasible}]} numberOfLines={1}>
                    {plan?.alternatives.length ?? 0} verified alternative
                    {plan?.alternatives.length === 1 ? '' : 's'}
                  </Text>
                </View>
              </FocusTile>
            </Pressable>
          )}
          <Pressable
            testID="tile-reset"
            accessibilityLabel="Reset to default plan"
            onFocus={() => setFocus('reset')}
            onPress={guard(resetToDefault)}
            style={styles.actionSlot}>
            <FocusTile focused={focus === 'reset'} style={[styles.actionCard, focus === 'reset' && styles.cardFocused]}>
              <Icon name="reset" size={26} color={colors.text} />
              <View style={styles.actionTextGroup}>
                <Text style={styles.actionTitle} numberOfLines={1}>Reset to default</Text>
              </View>
            </FocusTile>
          </Pressable>
        </TVFocusGuideView>

        <Text style={styles.footer}>{plan?.limits}</Text>
      </View>
    );
  }

  // ---------------- Appliance edit ----------------
  function renderApplianceEdit() {
    if (!editingId) {
      return null;
    }
    const info = applianceInfo?.[editingId];
    const hours = hoursFor(editingId);
    const windowLen = info ? new Set(info.allowed_hours).size : OUTAGE_HOURS;
    const hoursRatio = windowLen > 0 ? clamp(hours / windowLen, 0, 1) : 0;
    const isCritical = criticalIds.has(editingId);
    const showSafetyCaution = !isCritical && SAFETY_SENSITIVE_IDS.has(editingId);
    return (
      <View style={styles.screen} testID="screen-edit-appliance">
        <View style={styles.editHeaderRow}>
          <View style={styles.editHeaderIcon}>
            <Icon name={editingId as IconName} size={30} color={colors.text} />
          </View>
          <View style={styles.editHeaderText}>
            <Text style={styles.title}>
              {applianceLabel[editingId]}
              {isCritical ? '  ·  essential service' : ''}
            </Text>
            <Text style={styles.subtitle}>
              {info ? `${info.low_w}-${info.high_w} W · available ${windowLen}h of this outage` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.infoBanner} testID="essential-note">
          <Text style={styles.infoBannerText}>{essentialNoteFor(editingId, isCritical)}</Text>
        </View>
        {showSafetyCaution && (
          <View style={styles.cautionBanner} testID="safety-caution-edit">
            <Icon name="warning" size={18} color={colors.infeasible} />
            <Text style={styles.cautionBannerText}>{SAFETY_NOTE[editingId]}</Text>
          </View>
        )}
        {renderStatusLine()}

        <Text style={styles.bigValue} testID="appliance-hours-value">{hours}h required</Text>
        <View style={styles.miniTrackWide}>
          <View style={[styles.miniFillWide, {width: `${hoursRatio * 100}%`}]} />
        </View>

        <TVFocusGuideView style={styles.stepperRow} autoFocus>
          <Pressable
            testID="btn-hours-minus"
            hasTVPreferredFocus
            accessibilityLabel="Decrease by 1 hour"
            onFocus={() => setFocus('minus')}
            onPress={guard(() => setApplianceHours(editingId, hours - 1))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'minus'} style={[styles.stepperButton, focus === 'minus' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>− 1h</Text>
            </FocusTile>
          </Pressable>
          <Pressable
            testID="btn-hours-plus"
            accessibilityLabel="Increase by 1 hour"
            onFocus={() => setFocus('plus')}
            onPress={guard(() => setApplianceHours(editingId, hours + 1))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'plus'} style={[styles.stepperButton, focus === 'plus' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>+ 1h</Text>
            </FocusTile>
          </Pressable>
          <Pressable
            testID="btn-hours-zero"
            accessibilityLabel="Turn off"
            onFocus={() => setFocus('zero')}
            onPress={guard(() => setApplianceHours(editingId, 0))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'zero'} style={[styles.stepperButton, focus === 'zero' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>Off</Text>
            </FocusTile>
          </Pressable>
        </TVFocusGuideView>
        <TVFocusGuideView style={styles.stepperRow}>
          <Pressable
            testID="btn-toggle-essential"
            accessibilityLabel={isCritical ? 'Unmark as essential' : 'Mark as essential'}
            onFocus={() => setFocus('toggle-essential')}
            onPress={guard(() => toggleEssential(editingId))}
            style={styles.toggleSlot}>
            <FocusTile
              focused={focus === 'toggle-essential'}
              style={[
                styles.essentialToggle,
                isCritical && styles.essentialToggleOn,
                focus === 'toggle-essential' && styles.cardFocused,
              ]}>
              <Text style={[styles.stepperButtonText, isCritical && {color: colors.accent}]}>
                {isCritical ? 'Unmark as essential' : 'Mark as essential'}
              </Text>
            </FocusTile>
          </Pressable>
        </TVFocusGuideView>
        {plan && (
          <View
            style={[
              styles.inlineStatus,
              {backgroundColor: plan.requested.result.feasible ? colors.feasibleDim : colors.infeasibleDim},
            ]}
            testID="appliance-edit-status">
            <Text
              style={[
                styles.inlineStatusText,
                {color: plan.requested.result.feasible ? colors.feasible : colors.infeasible},
              ]}>
              Plan is now {plan.requested.result.feasible ? 'FEASIBLE' : 'INFEASIBLE'}
            </Text>
          </View>
        )}
        <Text style={styles.footerHint}>Press Back to return to the overview</Text>
      </View>
    );
  }

  // ---------------- Battery edit ----------------
  function renderBatteryEdit() {
    return (
      <View style={styles.screen} testID="screen-edit-battery">
        <View style={styles.editHeaderRow}>
          <View style={styles.editHeaderIcon}>
            <Icon name="battery" size={30} color={colors.text} />
          </View>
          <View style={styles.editHeaderText}>
            <Text style={styles.title}>Battery</Text>
            <Text style={styles.subtitle}>Usable capacity and output limit for this outage</Text>
          </View>
        </View>
        {renderStatusLine()}

        <Text style={styles.sectionLabel}>Usable capacity</Text>
        <Text style={styles.bigValue} testID="battery-wh-value">{usableWh} Wh</Text>
        <TVFocusGuideView style={styles.stepperRow} autoFocus>
          <Pressable
            testID="btn-wh-minus"
            hasTVPreferredFocus
            accessibilityLabel="Decrease capacity by 100 watt hours"
            onFocus={() => setFocus('wh-minus')}
            onPress={guard(() => setBattery(usableWh - 100, maxW))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'wh-minus'} style={[styles.stepperButton, focus === 'wh-minus' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>− 100 Wh</Text>
            </FocusTile>
          </Pressable>
          <Pressable
            testID="btn-wh-plus"
            accessibilityLabel="Increase capacity by 100 watt hours"
            onFocus={() => setFocus('wh-plus')}
            onPress={guard(() => setBattery(usableWh + 100, maxW))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'wh-plus'} style={[styles.stepperButton, focus === 'wh-plus' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>+ 100 Wh</Text>
            </FocusTile>
          </Pressable>
        </TVFocusGuideView>

        <Text style={[styles.sectionLabel, {marginTop: spacing.xs}]}>Output limit</Text>
        <Text style={styles.bigValue} testID="battery-maxw-value">{maxW} W limit</Text>
        <TVFocusGuideView style={styles.stepperRow}>
          <Pressable
            testID="btn-w-minus"
            accessibilityLabel="Decrease output limit by 10 watts"
            onFocus={() => setFocus('w-minus')}
            onPress={guard(() => setBattery(usableWh, maxW - 10))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'w-minus'} style={[styles.stepperButton, focus === 'w-minus' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>− 10 W</Text>
            </FocusTile>
          </Pressable>
          <Pressable
            testID="btn-w-plus"
            accessibilityLabel="Increase output limit by 10 watts"
            onFocus={() => setFocus('w-plus')}
            onPress={guard(() => setBattery(usableWh, maxW + 10))}
            style={styles.stepperSlot}>
            <FocusTile focused={focus === 'w-plus'} style={[styles.stepperButton, focus === 'w-plus' && styles.cardFocused]}>
              <Text style={styles.stepperButtonText}>+ 10 W</Text>
            </FocusTile>
          </Pressable>
        </TVFocusGuideView>

        {plan && (
          <View
            style={[
              styles.inlineStatus,
              {backgroundColor: plan.requested.result.feasible ? colors.feasibleDim : colors.infeasibleDim},
            ]}>
            <Text
              style={[
                styles.inlineStatusText,
                {color: plan.requested.result.feasible ? colors.feasible : colors.infeasible},
              ]}>
              Plan is now {plan.requested.result.feasible ? 'FEASIBLE' : 'INFEASIBLE'}
            </Text>
          </View>
        )}
        <Text style={styles.footerHint}>Press Back to return to the overview</Text>
      </View>
    );
  }

  // ---------------- Conflict + alternatives ----------------
  function renderAlternatives() {
    if (!plan) {
      return null;
    }
    return (
      <ScrollView ref={alternativesScrollRef} style={styles.screen} testID="screen-alternatives">
        <Text style={styles.title}>Why this doesn't fit</Text>
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerText}>{plan.requested.explanation}</Text>
        </View>
        {renderStatusLine()}

        <Text style={styles.sectionLabel}>Pick a verified alternative</Text>
        {plan.alternatives.length === 0 && (
          <Text style={styles.paragraph} testID="no-alternatives">
            No automatic fix was found by changing one or two appliances. Try reducing more
            requirements yourself, or raise the battery capacity.
          </Text>
        )}
        <TVFocusGuideView style={styles.alternativesRow} autoFocus>
          {plan.alternatives.map((alt, i) => {
            const protects = alt.tier === 'protects_essentials';
            const altRatio = budgetWh > 0 ? clamp((alt.result.energy_wh ?? 0) / budgetWh, 0, 1) : 0;
            return (
              <Pressable
                key={alt.id}
                testID={`alt-card-${alt.id}`}
                hasTVPreferredFocus={i === 0}
                accessibilityLabel={`Alternative ${alt.id}: ${alt.summary}`}
                onFocus={() => setFocus('alt-' + alt.id)}
                onPress={guard(() => applyAlternative(alt))}
                style={styles.altSlot}>
                <FocusTile
                  focused={focus === 'alt-' + alt.id}
                  style={[styles.altCard, focus === 'alt-' + alt.id && styles.cardFocused]}>
                  <View
                    style={[
                      styles.tierBadge,
                      {backgroundColor: protects ? colors.feasibleDim : colors.infeasibleDim},
                    ]}
                    testID={`alt-tier-${alt.id}`}>
                    <Text style={[styles.tierBadgeText, {color: protects ? colors.feasible : colors.infeasible}]}>
                      {protects ? '✓ Protects essentials' : '⚠ Requires compromise'}
                    </Text>
                  </View>
                  <Text style={styles.altTitle}>Alternative {alt.id}</Text>
                  <Text style={styles.altChange}>Reduces: {alt.label}</Text>

                  <View style={styles.altProtectedWrap}>
                    <Text style={styles.altProtectedLabel}>
                      Stays as requested: {alt.stays_powered.map(id => applianceLabel[id] ?? id).join(', ')}
                    </Text>
                  </View>

                  <Text style={styles.altSummary}>{alt.summary}</Text>

                  <View style={styles.altStatRow}>
                    <View style={styles.altStatBarWrap}>
                      <View style={styles.miniTrackWide}>
                        <View
                          style={[
                            styles.miniFillWide,
                            {width: `${altRatio * 100}%`, backgroundColor: colors.feasible},
                          ]}
                        />
                      </View>
                      <Text style={styles.altStat}>
                        {alt.result.energy_wh} Wh used · {alt.result.remaining_wh} Wh left · peak{' '}
                        {alt.result.peak_w} W
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={[
                      styles.altVerified,
                      {color: alt.independent_verification?.valid ? colors.feasible : colors.infeasible},
                    ]}>
                    {alt.independent_verification?.valid
                      ? '✓ Independently verified'
                      : '✗ verification failed'}
                  </Text>
                  {(() => {
                    const caution = alternativeSafetyCaution(alt.changed.map(c => c.id));
                    return caution ? (
                      <View style={styles.cautionBanner} testID={`alt-safety-caution-${alt.id}`}>
                        <Icon name="warning" size={16} color={colors.infeasible} />
                        <Text style={styles.cautionBannerText}>{caution}</Text>
                      </View>
                    ) : null;
                  })()}
                  <View style={styles.altApplyRow}>
                    <Text style={styles.altApply}>Select to apply</Text>
                  </View>
                </FocusTile>
              </Pressable>
            );
          })}
        </TVFocusGuideView>
        <Text style={styles.footer}>{plan.limits}</Text>
        <Text style={styles.footerHint}>Press Back to return to the overview</Text>
      </ScrollView>
    );
  }

  if (page === 'editAppliance') {
    return renderApplianceEdit();
  }
  if (page === 'editBattery') {
    return renderBatteryEdit();
  }
  if (page === 'alternatives') {
    return renderAlternatives();
  }
  return renderOverview();
};

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.md},
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  wordmark: {fontSize: type.title, color: colors.text, fontWeight: '800', letterSpacing: -0.5},
  title: {fontSize: type.h1, color: colors.text, fontWeight: '700'},
  subtitle: {fontSize: type.body, color: colors.accent, marginTop: spacing.xs},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  statusDot: {width: 9, height: 9, borderRadius: 5, marginRight: spacing.xs},
  statusText: {fontSize: type.h2, fontWeight: '800', letterSpacing: 0.5},

  heroPanel: {
    flexDirection: 'row',
    backgroundColor: colors.bgHero,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  heroMain: {flex: 1},
  heroLabel: {fontSize: type.label, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700'},
  heroNumberRow: {flexDirection: 'row', alignItems: 'flex-end', marginTop: 2},
  heroNumber: {fontSize: 46, fontWeight: '800', lineHeight: 46},
  heroNumberUnit: {fontSize: type.small, color: colors.textDim, marginBottom: 5, marginLeft: spacing.xs},
  energyTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.energyTrack,
    marginTop: spacing.xs,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  energyFill: {height: '100%', borderRadius: 6},
  energyTrackMarker: {position: 'absolute', right: 0, top: 0, bottom: 0, width: 2, backgroundColor: colors.border},
  heroStat: {
    width: 150,
    marginLeft: spacing.md,
    paddingLeft: spacing.md,
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
    justifyContent: 'center',
  },
  heroStatLabel: {fontSize: type.label, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700'},
  heroStatValue: {fontSize: 30, fontWeight: '800', marginTop: 2},
  heroStatUnit: {fontSize: type.body, fontWeight: '600'},
  heroStatCaption: {fontSize: type.caption, color: colors.textFaint, marginTop: 2},

  errorText: {color: colors.infeasible, fontSize: type.small, marginTop: spacing.xs},
  loadingText: {color: colors.textFaint, fontSize: type.small, marginTop: spacing.xs},

  sectionLabel: {
    fontSize: type.label,
    color: colors.textDim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },

  applianceRow: {flexDirection: 'row'},
  applianceSlot: {flex: 1, marginHorizontal: spacing.xs / 2, height: 148},
  applianceCard: {
    flex: 1,
    padding: spacing.xs,
    backgroundColor: colors.bgCard,
    borderWidth: 2,
    borderColor: colors.bgCard,
    borderRadius: radius.md,
    justifyContent: 'flex-start',
  },
  applianceCardCritical: {borderColor: colors.accentSoft, backgroundColor: colors.bgCardCritical},
  essentialPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  essentialPillText: {fontSize: 10, fontWeight: '800'},
  essentialPillSpacer: {height: 10 + 2 * 2 + 2},

  actionRow: {flexDirection: 'row', marginTop: spacing.xs},
  actionSlot: {flex: 1, marginHorizontal: spacing.xs / 2, height: 68},
  actionCard: {
    flex: 1,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.bgPanel,
    borderRadius: radius.md,
    alignItems: 'center',
    flexDirection: 'row',
  },
  actionCardAlert: {borderColor: colors.infeasibleDim},
  actionTextGroup: {marginLeft: spacing.sm, flexShrink: 1},
  actionTitle: {fontSize: type.body, color: colors.text, fontWeight: '700'},
  actionValue: {fontSize: type.small, color: colors.textDim, marginTop: 2},

  cardFocused: {borderColor: colors.borderFocused, backgroundColor: colors.bgCardFocused},

  applianceName: {fontSize: type.small, color: colors.text, fontWeight: '700', marginTop: 2},
  applianceHours: {fontSize: type.h2, color: colors.accent, fontWeight: '800', marginTop: 0},
  applianceWatts: {fontSize: type.caption, color: colors.textFaint, marginTop: 2},

  miniTrack: {height: 5, borderRadius: 2.5, backgroundColor: colors.energyTrack, marginTop: 3, overflow: 'hidden'},
  miniFill: {height: '100%', borderRadius: 2.5, backgroundColor: colors.accent},
  miniTrackWide: {height: 8, borderRadius: 4, backgroundColor: colors.energyTrack, marginTop: spacing.xs, overflow: 'hidden', width: '100%'},
  miniFillWide: {height: '100%', borderRadius: 5, backgroundColor: colors.accent},

  footer: {fontSize: type.caption, color: colors.textFaint, marginTop: spacing.sm},
  footerHint: {fontSize: type.caption, color: colors.textFaint, marginTop: spacing.sm, marginBottom: spacing.md},

  editHeaderRow: {flexDirection: 'row', alignItems: 'center'},
  editHeaderIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  editHeaderText: {flexShrink: 1},

  infoBanner: {
    backgroundColor: colors.bgPanel,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  infoBannerText: {fontSize: type.small, color: colors.textDim, lineHeight: 22},

  cautionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.infeasibleDim,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  cautionBannerText: {
    flex: 1,
    fontSize: type.small,
    color: colors.infeasible,
    lineHeight: 20,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },

  bigValue: {fontSize: 44, color: colors.text, fontWeight: '800', marginTop: spacing.sm},

  stepperRow: {flexDirection: 'row', marginTop: spacing.sm},
  stepperSlot: {marginRight: spacing.sm},
  stepperButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minWidth: 118,
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 2,
    borderColor: colors.bgCard,
    borderRadius: radius.md,
  },
  stepperButtonText: {fontSize: type.h2, color: colors.text, fontWeight: '700'},

  toggleSlot: {marginRight: spacing.sm},
  essentialToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgCard,
    borderWidth: 2,
    borderColor: colors.bgCard,
    borderRadius: radius.md,
  },
  essentialToggleOn: {borderColor: colors.accentSoft, backgroundColor: colors.bgCardCritical},

  inlineStatus: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  inlineStatusText: {fontSize: type.h2, fontWeight: '800'},

  paragraph: {fontSize: type.body, color: colors.textDim, lineHeight: 29, marginTop: spacing.sm, marginBottom: spacing.sm},

  alternativesRow: {flexDirection: 'row'},
  altSlot: {flex: 1, marginHorizontal: spacing.xs},
  altCard: {
    padding: spacing.md,
    backgroundColor: colors.bgCard,
    borderWidth: 2,
    borderColor: colors.bgCard,
    borderRadius: radius.lg,
  },
  tierBadge: {alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill},
  tierBadgeText: {fontSize: 12, fontWeight: '800'},
  altTitle: {fontSize: type.h2, color: colors.text, fontWeight: '800', marginTop: spacing.xs},
  altChange: {fontSize: type.body, color: colors.accent, marginTop: 2, fontWeight: '700'},
  altProtectedWrap: {marginTop: spacing.xs, backgroundColor: colors.bgPanel, borderRadius: radius.sm, padding: spacing.xs},
  altProtectedLabel: {fontSize: type.caption, color: colors.textDim, lineHeight: 18},
  altSummary: {fontSize: type.caption, color: colors.textDim, lineHeight: 18, marginTop: spacing.xs},
  altStatRow: {marginTop: spacing.xs},
  altStatBarWrap: {width: '100%'},
  altStat: {fontSize: type.caption, color: colors.textFaint, marginTop: 3},
  altVerified: {fontSize: type.caption, marginTop: spacing.xs, fontWeight: '700'},
  altApplyRow: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  altApply: {fontSize: type.caption, color: colors.textDim, fontWeight: '600'},
  safetyCaution: {
    fontSize: type.small,
    color: colors.infeasible,
    lineHeight: 22,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
});
