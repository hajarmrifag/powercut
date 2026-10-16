import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView, useKeplerBackHandler} from '@amazon-devices/react-native-kepler';
import {fetchDefaults, fetchPlan} from './api';
import {applianceIcon, applianceLabel, colors, spacing, type} from './theme';
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
    `⚠ Verified against the energy math only -- not a guarantee of ${concerns}.`
  );
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
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

  // ---------------- Overview ----------------
  function renderOverview() {
    return (
      <View style={styles.screen} testID="screen-overview">
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>PowerCut</Text>
            <Text style={styles.subtitle}>{plan?.title ?? "Tonight's outage plan"} · {OUTAGE_HOURS}h</Text>
          </View>
          {feasible !== null && (
            <View
              style={[
                styles.statusBadge,
                {backgroundColor: feasible ? colors.feasibleDim : colors.infeasibleDim},
              ]}
              testID="status-badge">
              <Text style={[styles.statusText, {color: feasible ? colors.feasible : colors.infeasible}]}>
                {feasible ? 'FEASIBLE' : 'INFEASIBLE'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.energyPanel}>
          <View style={styles.energyLabelRow}>
            <Text style={styles.energyLabel}>Energy needed</Text>
            <Text style={styles.energyValue}>
              {requestedWh} Wh of {budgetWh} Wh
            </Text>
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
          </View>
          {renderStatusLine()}
        </View>

        <TVFocusGuideView style={styles.applianceRow} autoFocus>
          {APPLIANCE_IDS.map((id, i) => {
            const info = applianceInfo?.[id];
            const isCritical = criticalIds.has(id);
            const wasReduced = plan?.requested.critical_reduced.includes(id);
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
                style={[
                  styles.applianceCard,
                  isCritical && styles.applianceCardCritical,
                  focus === id && styles.cardFocused,
                ]}>
                {isCritical && (
                  <Text style={styles.essentialBadge} testID={`badge-essential-${id}`}>
                    {wasReduced ? '⚠ essential' : '✓ essential'}
                  </Text>
                )}
                <Text style={styles.applianceIcon}>{applianceIcon[id]}</Text>
                <Text style={styles.applianceName}>{applianceLabel[id]}</Text>
                <Text style={styles.applianceHours}>{hoursFor(id)}h</Text>
                {info && <Text style={styles.applianceWatts}>{info.low_w}-{info.high_w} W</Text>}
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
            style={[styles.actionCard, focus === 'battery' && styles.cardFocused]}>
            <Text style={styles.actionIcon}>🔋</Text>
            <View>
              <Text style={styles.applianceName}>Battery</Text>
              <Text style={styles.actionValue}>{usableWh} Wh · {maxW} W limit</Text>
            </View>
          </Pressable>
          {feasible === false && (
            <Pressable
              testID="tile-alternatives"
              accessibilityLabel="View conflict and alternatives"
              onFocus={() => setFocus('alternatives')}
              onPress={() => setPage('alternatives')}
              style={[styles.actionCard, focus === 'alternatives' && styles.cardFocused]}>
              <Text style={styles.actionIcon}>⚠️</Text>
              <Text style={styles.applianceName}>Why, and how to fix it</Text>
            </Pressable>
          )}
          <Pressable
            testID="tile-reset"
            accessibilityLabel="Reset to default plan"
            onFocus={() => setFocus('reset')}
            onPress={guard(resetToDefault)}
            style={[styles.actionCard, focus === 'reset' && styles.cardFocused]}>
            <Text style={styles.actionIcon}>↺</Text>
            <Text style={styles.applianceName}>Reset to default</Text>
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
    const isCritical = criticalIds.has(editingId);
    return (
      <View style={styles.screen} testID="screen-edit-appliance">
        <Text style={styles.title}>
          {applianceIcon[editingId]} {applianceLabel[editingId]}
          {isCritical ? '  ·  essential service' : ''}
        </Text>
        <Text style={styles.subtitle}>
          {info ? `${info.low_w}-${info.high_w} W · available ${windowLen}h of this outage` : ''}
        </Text>
        <Text style={styles.paragraph} testID="essential-note">
          {essentialNoteFor(editingId, isCritical)}
        </Text>
        {!isCritical && SAFETY_SENSITIVE_IDS.has(editingId) && (
          <Text style={styles.safetyCaution} testID="safety-caution-edit">
            {SAFETY_NOTE[editingId]}
          </Text>
        )}
        {renderStatusLine()}
        <Text style={styles.bigValue} testID="appliance-hours-value">{hours}h required</Text>
        <TVFocusGuideView style={styles.stepperRow} autoFocus>
          <Pressable
            testID="btn-hours-minus"
            hasTVPreferredFocus
            accessibilityLabel="Decrease by 1 hour"
            onFocus={() => setFocus('minus')}
            onPress={guard(() => setApplianceHours(editingId, hours - 1))}
            style={[styles.stepperButton, focus === 'minus' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>− 1h</Text>
          </Pressable>
          <Pressable
            testID="btn-hours-plus"
            accessibilityLabel="Increase by 1 hour"
            onFocus={() => setFocus('plus')}
            onPress={guard(() => setApplianceHours(editingId, hours + 1))}
            style={[styles.stepperButton, focus === 'plus' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>+ 1h</Text>
          </Pressable>
          <Pressable
            testID="btn-hours-zero"
            accessibilityLabel="Turn off"
            onFocus={() => setFocus('zero')}
            onPress={guard(() => setApplianceHours(editingId, 0))}
            style={[styles.stepperButton, focus === 'zero' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>Off</Text>
          </Pressable>
        </TVFocusGuideView>
        <TVFocusGuideView style={styles.stepperRow}>
          <Pressable
            testID="btn-toggle-essential"
            accessibilityLabel={isCritical ? 'Unmark as essential' : 'Mark as essential'}
            onFocus={() => setFocus('toggle-essential')}
            onPress={guard(() => toggleEssential(editingId))}
            style={[
              styles.essentialToggle,
              isCritical && styles.essentialToggleOn,
              focus === 'toggle-essential' && styles.cardFocused,
            ]}>
            <Text style={styles.stepperButtonText}>
              {isCritical ? '✓ Essential — unmark' : 'Mark as essential'}
            </Text>
          </Pressable>
        </TVFocusGuideView>
        {plan && (
          <Text
            style={[
              styles.livePreview,
              {color: plan.requested.result.feasible ? colors.feasible : colors.infeasible},
            ]}
            testID="appliance-edit-status">
            Plan is now {plan.requested.result.feasible ? 'FEASIBLE' : 'INFEASIBLE'}
          </Text>
        )}
        <Text style={styles.footerHint}>Press Back to return to the overview</Text>
      </View>
    );
  }

  // ---------------- Battery edit ----------------
  function renderBatteryEdit() {
    return (
      <View style={styles.screen} testID="screen-edit-battery">
        <Text style={styles.title}>🔋 Battery</Text>
        <Text style={styles.subtitle}>Usable capacity and output limit for this outage</Text>
        {renderStatusLine()}

        <Text style={styles.bigValue} testID="battery-wh-value">{usableWh} Wh</Text>
        <TVFocusGuideView style={styles.stepperRow} autoFocus>
          <Pressable
            testID="btn-wh-minus"
            hasTVPreferredFocus
            accessibilityLabel="Decrease capacity by 100 watt hours"
            onFocus={() => setFocus('wh-minus')}
            onPress={guard(() => setBattery(usableWh - 100, maxW))}
            style={[styles.stepperButton, focus === 'wh-minus' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>− 100 Wh</Text>
          </Pressable>
          <Pressable
            testID="btn-wh-plus"
            accessibilityLabel="Increase capacity by 100 watt hours"
            onFocus={() => setFocus('wh-plus')}
            onPress={guard(() => setBattery(usableWh + 100, maxW))}
            style={[styles.stepperButton, focus === 'wh-plus' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>+ 100 Wh</Text>
          </Pressable>
        </TVFocusGuideView>

        <Text style={[styles.bigValue, {marginTop: spacing.lg}]} testID="battery-maxw-value">{maxW} W limit</Text>
        <TVFocusGuideView style={styles.stepperRow}>
          <Pressable
            testID="btn-w-minus"
            accessibilityLabel="Decrease output limit by 10 watts"
            onFocus={() => setFocus('w-minus')}
            onPress={guard(() => setBattery(usableWh, maxW - 10))}
            style={[styles.stepperButton, focus === 'w-minus' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>− 10 W</Text>
          </Pressable>
          <Pressable
            testID="btn-w-plus"
            accessibilityLabel="Increase output limit by 10 watts"
            onFocus={() => setFocus('w-plus')}
            onPress={guard(() => setBattery(usableWh, maxW + 10))}
            style={[styles.stepperButton, focus === 'w-plus' && styles.cardFocused]}>
            <Text style={styles.stepperButtonText}>+ 10 W</Text>
          </Pressable>
        </TVFocusGuideView>

        {plan && (
          <Text
            style={[
              styles.livePreview,
              {color: plan.requested.result.feasible ? colors.feasible : colors.infeasible},
            ]}>
            Plan is now {plan.requested.result.feasible ? 'FEASIBLE' : 'INFEASIBLE'}
          </Text>
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
      <ScrollView style={styles.screen} testID="screen-alternatives">
        <Text style={styles.title}>Why this doesn't fit</Text>
        <Text style={styles.paragraph}>{plan.requested.explanation}</Text>
        {renderStatusLine()}

        <Text style={styles.sectionTitle}>Pick a verified alternative</Text>
        {plan.alternatives.length === 0 && (
          <Text style={styles.paragraph} testID="no-alternatives">
            No automatic fix was found by changing one or two appliances. Try reducing more
            requirements yourself, or raise the battery capacity.
          </Text>
        )}
        <TVFocusGuideView style={styles.alternativesRow} autoFocus>
          {plan.alternatives.map((alt, i) => {
            const protects = alt.tier === 'protects_essentials';
            return (
              <Pressable
                key={alt.id}
                testID={`alt-card-${alt.id}`}
                hasTVPreferredFocus={i === 0}
                accessibilityLabel={`Alternative ${alt.id}: ${alt.summary}`}
                onFocus={() => setFocus('alt-' + alt.id)}
                onPress={guard(() => applyAlternative(alt))}
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
                <Text style={styles.altStaysPowered}>
                  Stays as requested: {alt.stays_powered.map(id => applianceLabel[id] ?? id).join(', ')}
                </Text>
                <Text style={styles.altSummary}>{alt.summary}</Text>
                <Text style={styles.altStat}>
                  {alt.result.energy_wh} Wh used · {alt.result.remaining_wh} Wh left · peak{' '}
                  {alt.result.peak_w} W
                </Text>
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
                    <Text style={styles.safetyCaution} testID={`alt-safety-caution-${alt.id}`}>
                      {caution}
                    </Text>
                  ) : null;
                })()}
                <Text style={styles.altApply}>Select to apply</Text>
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
  screen: {flex: 1, backgroundColor: colors.bg, padding: spacing.lg},
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: type.title, color: colors.text, fontWeight: 'bold'},
  subtitle: {fontSize: type.h2, color: colors.accent, marginTop: spacing.xs},
  statusBadge: {paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 10},
  statusText: {fontSize: type.h2, fontWeight: 'bold'},
  energyPanel: {marginTop: spacing.md, marginBottom: spacing.sm},
  energyLabelRow: {flexDirection: 'row', justifyContent: 'space-between'},
  energyLabel: {fontSize: type.body, color: colors.textDim},
  energyValue: {fontSize: type.body, color: colors.text},
  energyTrack: {
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.energyTrack,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  energyFill: {height: '100%', borderRadius: 9},
  errorText: {color: colors.infeasible, fontSize: type.small, marginTop: spacing.xs},
  loadingText: {color: colors.textFaint, fontSize: type.small, marginTop: spacing.xs},
  applianceRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm},
  actionRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs},
  applianceCard: {
    width: 128,
    height: 104,
    margin: spacing.xs,
    padding: spacing.xs,
    backgroundColor: colors.bgCard,
    borderWidth: 3,
    borderColor: colors.bgCard,
    borderRadius: 12,
    justifyContent: 'center',
  },
  applianceCardCritical: {borderColor: colors.accentDim},
  essentialBadge: {
    position: 'absolute',
    top: 4,
    right: 6,
    fontSize: 10,
    color: colors.accent,
    fontWeight: '700',
  },
  actionCard: {
    width: 264,
    height: 76,
    margin: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.bgPanel,
    borderWidth: 3,
    borderColor: colors.bgPanel,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  cardFocused: {borderColor: colors.borderFocused, backgroundColor: colors.bgCardFocused},
  applianceIcon: {fontSize: 24, marginBottom: 2},
  actionIcon: {fontSize: 26, marginRight: spacing.sm},
  applianceName: {fontSize: 14, color: colors.text, fontWeight: '600'},
  applianceHours: {fontSize: type.h2, color: colors.accent, fontWeight: 'bold'},
  applianceWatts: {fontSize: 12, color: colors.textFaint},
  actionValue: {fontSize: 13, color: colors.accent, marginTop: 2},
  footer: {fontSize: type.small, color: colors.textFaint, marginTop: spacing.lg},
  footerHint: {fontSize: type.small, color: colors.textFaint, marginTop: spacing.lg, marginBottom: spacing.xl},
  bigValue: {fontSize: 56, color: colors.text, fontWeight: 'bold', marginTop: spacing.md},
  stepperRow: {flexDirection: 'row', marginTop: spacing.md},
  stepperButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgCard,
    borderWidth: 3,
    borderColor: colors.bgCard,
    borderRadius: 14,
    marginRight: spacing.sm,
  },
  stepperButtonText: {fontSize: type.h2, color: colors.text, fontWeight: 'bold'},
  essentialToggle: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgCard,
    borderWidth: 3,
    borderColor: colors.bgCard,
    borderRadius: 14,
  },
  essentialToggleOn: {borderColor: colors.accentDim},
  safetyCaution: {
    fontSize: type.small,
    color: colors.infeasible,
    lineHeight: 22,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  livePreview: {fontSize: type.h2, marginTop: spacing.lg, fontWeight: 'bold'},
  paragraph: {fontSize: type.body, color: colors.textDim, lineHeight: 29, marginTop: spacing.sm, marginBottom: spacing.sm},
  sectionTitle: {fontSize: type.h2, color: colors.accent, marginTop: spacing.md, marginBottom: spacing.sm},
  alternativesRow: {flexDirection: 'row', flexWrap: 'wrap'},
  altCard: {
    width: 440,
    padding: spacing.md,
    margin: spacing.xs,
    backgroundColor: colors.bgCard,
    borderWidth: 3,
    borderColor: colors.bgCard,
    borderRadius: 14,
  },
  tierBadge: {alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 8},
  tierBadgeText: {fontSize: 13, fontWeight: '700'},
  altTitle: {fontSize: type.h2, color: colors.text, fontWeight: 'bold', marginTop: spacing.xs},
  altChange: {fontSize: type.body, color: colors.accent, marginTop: spacing.xs},
  altStaysPowered: {fontSize: type.small, color: colors.textDim, marginTop: 2},
  altSummary: {fontSize: type.small, color: colors.textDim, lineHeight: 22, marginTop: spacing.sm},
  altStat: {fontSize: type.small, color: colors.textDim, marginTop: spacing.sm},
  altVerified: {fontSize: type.small, marginTop: spacing.sm, fontWeight: '600'},
  altApply: {fontSize: type.small, color: colors.textFaint, marginTop: spacing.sm},
});
