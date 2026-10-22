import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView, useKeplerBackHandler} from '@amazon-devices/react-native-kepler';
import Svg, {Path} from '@amazon-devices/react-native-svg';
import {fetchDefaults, fetchPlan} from './api';
import {Icon, type IconName} from './icons';
import {applianceIconName, applianceLabel, colors, flow, motion, radius, spacing, type} from './theme';
import type {Alternative, ApplianceRequirement, Defaults, Plan} from './types';

type Page = 'overview' | 'editAppliance' | 'editBattery' | 'alternatives';

const OUTAGE_HOURS = 12;
const APPLIANCE_IDS = ['fridge', 'router', 'lamp', 'phone', 'laptop', 'fan'];
const DEFAULT_CRITICAL_IDS = new Set(['fridge', 'router']);

// ---- Overview energy-flow geometry -------------------------------------
// The overview's centerpiece is a Sankey ribbon from the battery budget
// into each appliance's share of tonight's demand. Ribbons are drawn as
// real vector paths via @amazon-devices/react-native-svg, Amazon's own
// Kepler-platform fork of react-native-svg (declared Kepler module
// com.amazon.kepler.svg_3@ISVG_0, version-matched to this project's exact
// react-native/react-native-kepler versions) -- not a third-party native
// module of unknown Vega support. An earlier build approximated the curve
// as a strip of thin rectangles; at any slice density fine enough to look
// smooth at the edges, the strip's flat-color slices still show faint
// vertical seams in the fill under the device's rendering, which a true
// path fill does not have.
const FLOW_ROW_H = 26;
const FLOW_GAP = 6;
const FLOW_TOTAL_H = APPLIANCE_IDS.length * FLOW_ROW_H + (APPLIANCE_IDS.length - 1) * FLOW_GAP;
const FLOW_RIBBON_W = 200;
const FLOW_CAPSULE_W = 10;

type FlowRow = {id: string; wh: number; isCritical: boolean};
type FlowBand = {top: number; bottom: number};

function computeFlowBands(rows: FlowRow[], totalWh: number) {
  const safeTotal = totalWh > 0 ? totalWh : 1;
  let cum = 0;
  const src: FlowBand[] = rows.map(r => {
    const top = (cum / safeTotal) * FLOW_TOTAL_H;
    cum += r.wh;
    const bottom = (cum / safeTotal) * FLOW_TOTAL_H;
    return {top, bottom};
  });
  let y = 0;
  const dest: FlowBand[] = rows.map(() => {
    const band = {top: y, bottom: y + FLOW_ROW_H};
    y += FLOW_ROW_H + FLOW_GAP;
    return band;
  });
  return {src, dest};
}

// Same curve construction as the approved flow-overview-v3 mockup: two
// cubic beziers with control points at the horizontal midpoint, giving a
// flat tangent at both the capsule and row ends (the standard Sankey-link
// S-curve), closed into a single filled path per ribbon.
function buildRibbonPath(band: {src: FlowBand; dest: FlowBand}): string {
  const {src, dest} = band;
  const x0 = 0;
  const x1 = FLOW_RIBBON_W;
  const mid = (x0 + x1) / 2;
  return [
    `M ${x0} ${src.top}`,
    `C ${mid} ${src.top} ${mid} ${dest.top} ${x1} ${dest.top}`,
    `L ${x1} ${dest.bottom}`,
    `C ${mid} ${dest.bottom} ${mid} ${src.bottom} ${x0} ${src.bottom}`,
    'Z',
  ].join(' ');
}

// No Intl/toLocaleString dependency on-device: a plain regex grouping is
// guaranteed to work on Hermes without relying on bundled ICU data.
function formatWh(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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
  const capitalized = concerns.charAt(0).toUpperCase() + concerns.slice(1);
  const verb = touches.length > 1 ? 'are' : 'is';
  return `Verified against the energy model only. ${capitalized} ${verb} not guaranteed.`;
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
  const deltaWh = requestedWh - budgetWh;

  // ---------------- Overview ----------------
  // Energy-flow redesign: a Sankey-style ribbon from the battery budget
  // into each appliance's real share of tonight's demand (high_w *
  // required_hours per appliance, the same quantity the engine itself
  // sums to produce requested_wh -- see engine/solver.py's solve()).
  // Row order is the fixed APPLIANCE_IDS order, not sorted by size: a
  // household can mark any appliance essential at any time, and reordering
  // rows by their current Wh share would move the row under D-pad focus
  // out from under the remote the moment its data changed.
  function renderOverview() {
    const flowRows: FlowRow[] = APPLIANCE_IDS.map(id => {
      const info = applianceInfo?.[id];
      const wh = info ? info.high_w * hoursFor(id) : 0;
      return {id, wh, isCritical: criticalIds.has(id)};
    });
    const {src, dest} = computeFlowBands(flowRows, requestedWh);
    const capFrac = requestedWh > 0 ? budgetWh / requestedWh : 1;
    const capY = clamp(capFrac, 0, 1) * FLOW_TOTAL_H;
    const showOverage = deltaWh > 0 && plan !== null;

    return (
      <View style={flowStyles.screen} testID="screen-overview">
        <View style={flowStyles.topbar}>
          <Text style={flowStyles.word}>PowerCut</Text>
          <View style={flowStyles.topright}>
            {feasible !== null && (
              <View style={flowStyles.statusRow} testID="status-badge">
                <View
                  style={[
                    flowStyles.statusDot,
                    {backgroundColor: feasible ? colors.feasible : flow.coral},
                  ]}
                />
                <Text style={[flowStyles.statusWord, {color: feasible ? colors.feasible : flow.coral}]}>
                  {feasible ? 'FEASIBLE' : 'INFEASIBLE'}
                </Text>
              </View>
            )}
            <View style={flowStyles.legend}>
              <View style={flowStyles.legendItem}>
                <View style={[flowStyles.legendDot, {backgroundColor: flow.accent}]} />
                <Text style={flowStyles.legendText}>Essential</Text>
              </View>
              <View style={flowStyles.legendItem}>
                <View style={[flowStyles.legendDot, {backgroundColor: flow.flexible}]} />
                <Text style={flowStyles.legendText}>Flexible</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={flowStyles.hero}>
          <Text style={flowStyles.heroEyebrow}>Tonight&#39;s {OUTAGE_HOURS}-hour outage plan</Text>
          <Text style={flowStyles.heroNum}>{formatWh(requestedWh)} Wh</Text>
          {plan && (
            <Text style={flowStyles.heroSub}>
              {deltaWh > 0
                ? `That's `
                : `That leaves `}
              <Text style={flowStyles.heroSubStrong}>{formatWh(Math.abs(deltaWh))} Wh</Text>
              {deltaWh > 0
                ? ` more than the ${formatWh(budgetWh)} Wh the battery can give tonight.`
                : ` of the ${formatWh(budgetWh)} Wh battery unused tonight.`}
            </Text>
          )}
          {renderStatusLine()}
        </View>

        <View style={flowStyles.flowZone}>
          <View style={flowStyles.capsule}>
            {flowRows.map((r, i) => (
              <View
                key={r.id}
                style={{
                  height: Math.max(0, src[i].bottom - src[i].top),
                  backgroundColor: r.isCritical ? flow.accent : flow.flexible,
                  opacity: r.isCritical ? 1 : 0.55,
                }}
              />
            ))}
          </View>

          {showOverage && (
            <>
              <View style={[flowStyles.capacityTick, {top: capY - 1}]} />
              <View style={[flowStyles.capacityLabelWrap, {top: clamp(capY - 30, 0, FLOW_TOTAL_H - 30)}]}>
                <Text style={flowStyles.capacityLabel}>{formatWh(budgetWh)} Wh capacity</Text>
                <Text style={flowStyles.capacityOver}>{formatWh(deltaWh)} Wh over</Text>
              </View>
            </>
          )}

          <Svg
            width={FLOW_RIBBON_W}
            height={FLOW_TOTAL_H}
            style={flowStyles.ribbons}
            pointerEvents="none">
            {flowRows.map((r, i) => (
              <Path
                key={r.id}
                d={buildRibbonPath({src: src[i], dest: dest[i]})}
                fill={r.isCritical ? flow.accent : flow.flexible}
                fillOpacity={r.isCritical ? 0.42 : 0.3}
              />
            ))}
          </Svg>

          <TVFocusGuideView style={flowStyles.rows} autoFocus>
            {flowRows.map((r, i) => {
              const id = r.id;
              const wasReduced = plan?.requested.critical_reduced.includes(id);
              const showTag = r.isCritical && SAFETY_SENSITIVE_IDS.has(id);
              return (
                <Pressable
                  key={id}
                  testID={`tile-appliance-${id}`}
                  hasTVPreferredFocus={i === 0}
                  accessibilityLabel={
                    `${applianceLabel[id]}, ${hoursFor(id)} hours` +
                    (r.isCritical ? ', essential service' : '') +
                    (wasReduced ? ', reduced below full' : '')
                  }
                  onFocus={() => setFocus(id)}
                  onPress={() => {
                    setEditingId(id);
                    setPage('editAppliance');
                  }}
                  style={[flowStyles.rowSlot, {top: dest[i].top, height: FLOW_ROW_H}]}>
                  <FocusTile
                    focused={focus === id}
                    style={[flowStyles.row, focus === id && flowStyles.rowFocused]}>
                    <View
                      pointerEvents="none"
                      style={[
                        flowStyles.rowTint,
                        {backgroundColor: r.isCritical ? flow.accent : flow.flexible, opacity: r.isCritical ? 0.1 : 0.06},
                      ]}
                    />
                    <View style={flowStyles.rowIconSlot}>
                      <Icon name={id as IconName} size={11} color={flow.ink} />
                    </View>
                    <View style={flowStyles.rowText}>
                      <View style={flowStyles.rowNameLine}>
                        <Text style={flowStyles.rowName}>{applianceLabel[id]}</Text>
                        {r.isCritical && (
                          <Text
                            testID={`badge-essential-${id}`}
                            style={[
                              flowStyles.rowBadge,
                              {color: wasReduced ? flow.coral : flow.accent},
                            ]}>
                            {wasReduced ? '⚠ essential' : '✓ essential'}
                          </Text>
                        )}
                      </View>
                      {showTag && (
                        <Text style={flowStyles.rowTag} numberOfLines={1}>
                          {id === 'fridge'
                            ? 'Runtime prioritized, not a safety guarantee'
                            : 'Keeps connectivity up'}
                        </Text>
                      )}
                    </View>
                    <View style={flowStyles.rowStats}>
                      <Text style={flowStyles.rowHrs}>{hoursFor(id)}h</Text>
                      <Text style={flowStyles.rowWh}>{formatWh(r.wh)} Wh</Text>
                    </View>
                  </FocusTile>
                </Pressable>
              );
            })}
          </TVFocusGuideView>
        </View>

        <View style={flowStyles.shelf}>
          {feasible === false ? (
            <Pressable
              testID="tile-alternatives"
              accessibilityLabel="View conflict and alternatives"
              onFocus={() => setFocus('alternatives')}
              onPress={() => setPage('alternatives')}>
              <FocusTile focused={focus === 'alternatives'} style={flowStyles.ctaPrimary}>
                <Icon name="warning" size={13} color={flow.accentInk} />
                <View style={flowStyles.ctaText}>
                  <Text style={flowStyles.ctaTitle}>Why this doesn&#39;t fit</Text>
                  <Text style={flowStyles.ctaSub} numberOfLines={1}>
                    {plan?.alternatives.length ?? 0} verified way
                    {plan?.alternatives.length === 1 ? '' : 's'} to fix it tonight
                  </Text>
                </View>
              </FocusTile>
            </Pressable>
          ) : (
            null
          )}
          <TVFocusGuideView style={flowStyles.secondaryRow}>
            <Pressable
              testID="tile-battery"
              accessibilityLabel={`Battery, ${usableWh} watt hours, ${maxW} watt limit`}
              onFocus={() => setFocus('battery')}
              onPress={() => setPage('editBattery')}>
              <FocusTile
                focused={focus === 'battery'}
                style={[flowStyles.secondary, focus === 'battery' && flowStyles.secondaryFocused]}>
                <Icon name="battery" size={15} color={flow.inkDim} />
                <Text style={flowStyles.secondaryText} numberOfLines={1}>
                  Battery  <Text style={flowStyles.secondaryFaint}>{usableWh} Wh, {maxW} W limit</Text>
                </Text>
              </FocusTile>
            </Pressable>
            <Pressable
              testID="tile-reset"
              accessibilityLabel="Reset to default plan"
              onFocus={() => setFocus('reset')}
              onPress={guard(resetToDefault)}>
              <FocusTile
                focused={focus === 'reset'}
                style={[flowStyles.secondary, focus === 'reset' && flowStyles.secondaryFocused]}>
                <Icon name="reset" size={15} color={flow.inkDim} />
                <Text style={flowStyles.secondaryText} numberOfLines={1}>Reset to default</Text>
              </FocusTile>
            </Pressable>
          </TVFocusGuideView>
        </View>

        <Text style={flowStyles.footer}>{plan?.limits}</Text>
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
  // Same near-black / single-accent Sankey identity as the overview. Each
  // card's energy bar and per-appliance change rows are derived from the
  // same verified repair.result/repair.changed the engine already returned
  // -- nothing here is computed or estimated client-side.
  function renderAlternatives() {
    if (!plan) {
      return null;
    }
    return (
      <ScrollView ref={alternativesScrollRef} style={flowStyles.screen} testID="screen-alternatives">
        <Text style={flowStyles.altTitle}>Why this doesn't fit</Text>
        <View style={flowStyles.altExplainBanner}>
          <View style={flowStyles.altExplainIcon}>
            <Icon name="warning" size={15} color={flow.coral} />
          </View>
          <Text style={flowStyles.altExplainText}>{plan.requested.explanation}</Text>
        </View>
        {renderStatusLine()}

        <Text style={flowStyles.altSectionLabel}>Pick a verified alternative</Text>
        {plan.alternatives.length === 0 && (
          <Text style={flowStyles.altEmpty} testID="no-alternatives">
            No automatic fix was found by changing one or two appliances. Try reducing more
            requirements yourself, or raise the battery capacity.
          </Text>
        )}
        <TVFocusGuideView style={flowStyles.altRow} autoFocus>
          {plan.alternatives.map((alt, i) => {
            const protects = alt.tier === 'protects_essentials';
            const altEnergy = alt.result.energy_wh ?? 0;
            const altRatio = budgetWh > 0 ? clamp(altEnergy / budgetWh, 0, 1) : 0;
            const isFocused = focus === 'alt-' + alt.id;
            const caution = alternativeSafetyCaution(alt.changed.map(c => c.id));
            return (
              <Pressable
                key={alt.id}
                testID={`alt-card-${alt.id}`}
                hasTVPreferredFocus={i === 0}
                accessibilityLabel={`Alternative ${alt.id}: ${alt.summary}`}
                onFocus={() => setFocus('alt-' + alt.id)}
                onPress={guard(() => applyAlternative(alt))}
                style={flowStyles.altSlot}>
                <FocusTile
                  focused={isFocused}
                  style={[flowStyles.altCard, isFocused && flowStyles.altCardFocused]}>
                  <View
                    style={[
                      flowStyles.altTierBadge,
                      {backgroundColor: protects ? 'rgba(255,138,61,0.16)' : flow.coralSoft},
                    ]}
                    testID={`alt-tier-${alt.id}`}>
                    <Text style={[flowStyles.altTierBadgeText, {color: protects ? flow.accent : flow.coral}]}>
                      {protects ? '✓ Protects essentials' : '⚠ Requires compromise'}
                    </Text>
                  </View>
                  <Text style={flowStyles.altCardTitle}>Alternative {alt.id}</Text>
                  <Text style={flowStyles.altChangeHeadline}>Reduces: {alt.label}</Text>
                  <Text style={flowStyles.altCardSummary}>{alt.summary}</Text>

                  <View style={flowStyles.altEnergyWrap}>
                    <View style={flowStyles.altEnergyTrack}>
                      <View style={[flowStyles.altEnergyFill, {width: `${altRatio * 100}%`}]} />
                    </View>
                    <Text style={flowStyles.altEnergyStats}>
                      <Text style={flowStyles.altEnergyStatsStrong}>{formatWh(altEnergy)} Wh</Text> used
                      {'  ·  '}
                      <Text style={flowStyles.altEnergyStatsStrong}>{formatWh(alt.result.remaining_wh ?? 0)} Wh</Text>{' '}
                      left
                      {'  ·  '}peak <Text style={flowStyles.altEnergyStatsStrong}>{alt.result.peak_w} W</Text>
                    </Text>
                  </View>

                  {/* With exactly one changed appliance, the headline above
                      ("Reduces: fridge: 12h -> 8h") already says everything
                      this per-row list would -- skip the duplicate row and
                      keep it only where it adds real value: breaking a
                      multi-appliance change apart for easier reading. */}
                  {alt.changed.length > 1 && (
                    <View style={flowStyles.altChangesWrap}>
                      {alt.changed.map(c => (
                        <View key={c.id} style={flowStyles.altChangeRow}>
                          <View style={flowStyles.rowIconSlot}>
                            <Icon name={(applianceIconName[c.id] ?? c.id) as IconName} size={11} color={flow.ink} />
                          </View>
                          <Text style={flowStyles.altChangeLabel}>{applianceLabel[c.id] ?? c.id}</Text>
                          <Text style={flowStyles.altChangeHours}>
                            {c.from_hours}h <Text style={flowStyles.altChangeHoursNew}>→ {c.to_hours}h</Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <Text style={flowStyles.altStaysText}>
                    Stays as requested:{' '}
                    {alt.stays_powered.map((id, idx) => (
                      <Text key={id} style={SAFETY_SENSITIVE_IDS.has(id) ? flowStyles.altStaysStrong : undefined}>
                        {applianceLabel[id] ?? id}
                        {idx < alt.stays_powered.length - 1 ? ', ' : ''}
                      </Text>
                    ))}
                  </Text>

                  {caution && (
                    <View style={flowStyles.altCautionBanner} testID={`alt-safety-caution-${alt.id}`}>
                      <Icon name="warning" size={14} color={flow.coral} />
                      <Text style={flowStyles.altCautionText}>{caution}</Text>
                    </View>
                  )}

                  <Text
                    style={[
                      flowStyles.altVerifiedText,
                      {color: alt.independent_verification?.valid ? colors.feasible : flow.coral},
                    ]}>
                    {alt.independent_verification?.valid
                      ? '✓ Independently verified'
                      : '✗ verification failed'}
                  </Text>

                  <View style={flowStyles.altApplyRow}>
                    <Text style={flowStyles.altApplyText}>Select to apply</Text>
                  </View>
                </FocusTile>
              </Pressable>
            );
          })}
        </TVFocusGuideView>
        <Text style={flowStyles.footer}>{plan.limits}</Text>
        <Text style={flowStyles.altFooterHint}>Press Back to return to the overview</Text>
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

// Styles for the overview's energy-flow redesign only -- kept separate
// from `styles` above for the same reason `flow` is kept separate from
// `colors` in theme.ts (see the comment there).
const flowStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: flow.bg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  topbar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  word: {fontSize: type.title, fontWeight: '800', color: flow.ink, letterSpacing: -0.5},
  topright: {alignItems: 'flex-end'},
  statusRow: {flexDirection: 'row', alignItems: 'center'},
  statusDot: {width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs},
  statusWord: {fontSize: type.h2, fontWeight: '800', letterSpacing: 0.4},
  legend: {flexDirection: 'row', marginTop: spacing.xs},
  legendItem: {flexDirection: 'row', alignItems: 'center', marginLeft: spacing.md},
  legendDot: {width: 6, height: 6, borderRadius: 3, marginRight: 6},
  legendText: {fontSize: type.caption, color: flow.inkFaint},

  hero: {marginTop: spacing.sm, maxWidth: 560},
  heroEyebrow: {fontSize: type.small, color: flow.inkFaint},
  heroNum: {fontSize: 52, fontWeight: '800', color: flow.ink, marginTop: 2, letterSpacing: -0.5},
  heroSub: {fontSize: type.small, color: flow.inkDim, marginTop: 4, lineHeight: 19},
  heroSubStrong: {color: flow.ink, fontWeight: '700'},

  flowZone: {position: 'relative', marginTop: spacing.sm, height: FLOW_TOTAL_H},
  capsule: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: FLOW_CAPSULE_W,
    height: FLOW_TOTAL_H,
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  capacityTick: {position: 'absolute', left: FLOW_CAPSULE_W - 3, width: FLOW_CAPSULE_W + 10, height: 2, backgroundColor: flow.ink},
  capacityLabelWrap: {position: 'absolute', left: FLOW_CAPSULE_W + 10, width: 150},
  capacityLabel: {fontSize: 10.5, color: flow.inkDim, backgroundColor: flow.bg},
  capacityOver: {fontSize: 10, color: flow.coral, backgroundColor: flow.bg, marginTop: 1},

  ribbons: {position: 'absolute', left: FLOW_CAPSULE_W + 24, top: 0, width: FLOW_RIBBON_W, height: FLOW_TOTAL_H},

  rows: {position: 'absolute', left: FLOW_CAPSULE_W + 24 + FLOW_RIBBON_W, right: 0, top: 0, height: FLOW_TOTAL_H},
  rowSlot: {position: 'absolute', left: 0, right: 0},
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: flow.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: flow.line,
    paddingHorizontal: spacing.xs,
  },
  rowFocused: {borderColor: flow.accent},
  rowTint: {position: 'absolute', left: 0, top: 0, bottom: 0, right: '55%'},
  rowIconSlot: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: flow.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  rowText: {flex: 1, minWidth: 0},
  rowNameLine: {flexDirection: 'row', alignItems: 'center'},
  rowName: {fontSize: 12.5, fontWeight: '700', color: flow.ink},
  rowBadge: {fontSize: 8.5, fontWeight: '800', marginLeft: 5},
  rowTag: {fontSize: 9, color: flow.inkDim, marginTop: 0},
  rowStats: {alignItems: 'flex-end', marginLeft: 'auto', paddingLeft: spacing.xs},
  rowHrs: {fontSize: 12.5, fontWeight: '700', color: flow.ink},
  rowWh: {fontSize: 8.5, color: flow.inkFaint, marginTop: 0},

  shelf: {marginTop: spacing.xs},
  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: flow.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ctaText: {marginLeft: spacing.xs, flex: 1},
  ctaTitle: {fontSize: type.small, fontWeight: '800', color: flow.accentInk},
  ctaSub: {fontSize: 11, color: flow.accentInk, opacity: 0.72, marginTop: 1},

  secondaryRow: {flexDirection: 'row', marginTop: spacing.xs},
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.lg,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  secondaryFocused: {borderColor: flow.accent, backgroundColor: flow.surface},
  secondaryText: {fontSize: type.small, color: flow.inkDim, marginLeft: spacing.xs, fontWeight: '600'},
  secondaryFaint: {color: flow.inkFaint, fontWeight: '400', fontSize: type.caption},

  footer: {fontSize: type.caption, color: flow.inkFaint, marginTop: spacing.xs},

  // ---- Alternatives screen: same near-black / single-accent system as
  // the overview, so the two screens read as one product rather than a
  // restyled original plus a leftover default-theme screen. ----
  altTitle: {fontSize: type.h1, fontWeight: '800', color: flow.ink, letterSpacing: -0.5},
  altExplainBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: flow.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: flow.line,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  altExplainIcon: {marginTop: 2, marginRight: spacing.xs},
  altExplainText: {flex: 1, fontSize: type.small, color: flow.inkDim, lineHeight: 19},

  altSectionLabel: {
    fontSize: type.label,
    color: flow.inkFaint,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: spacing.xs,
    marginBottom: 4,
  },
  altEmpty: {fontSize: type.small, color: flow.inkDim, lineHeight: 20},

  altRow: {flexDirection: 'row'},
  altSlot: {flex: 1, marginHorizontal: spacing.xs},
  altCard: {
    backgroundColor: flow.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: spacing.sm,
  },
  altCardFocused: {borderColor: flow.accent},

  altTierBadge: {alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill},
  altTierBadgeText: {fontSize: 12, fontWeight: '800'},
  altCardTitle: {fontSize: type.h1, fontWeight: '800', color: flow.ink, marginTop: 4},
  altChangeHeadline: {fontSize: type.body, color: flow.accent, fontWeight: '700', marginTop: 1},
  altCardSummary: {fontSize: type.caption, color: flow.inkDim, lineHeight: 16, marginTop: 4},

  altEnergyWrap: {marginTop: spacing.xs},
  altEnergyTrack: {height: 10, borderRadius: 5, backgroundColor: flow.line, overflow: 'hidden'},
  altEnergyFill: {height: '100%', borderRadius: 5, backgroundColor: flow.accent},
  altEnergyStats: {fontSize: 11, color: flow.inkFaint, marginTop: 3},
  altEnergyStatsStrong: {color: flow.ink, fontWeight: '700'},

  altChangesWrap: {marginTop: 4},
  altChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: flow.line,
  },
  altChangeLabel: {flex: 1, fontSize: type.small, color: flow.ink, fontWeight: '600', marginLeft: 6},
  altChangeHours: {fontSize: type.small, color: flow.inkDim, fontWeight: '600'},
  altChangeHoursNew: {color: flow.ink, fontWeight: '800'},

  altStaysText: {fontSize: type.caption, color: flow.inkFaint, lineHeight: 15, marginTop: 4},
  altStaysStrong: {color: flow.accent, fontWeight: '700'},

  altCautionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: flow.coralSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 5,
    marginTop: 4,
  },
  altCautionText: {flex: 1, fontSize: 11.5, color: flow.coral, fontWeight: '600', marginLeft: 6, lineHeight: 15},

  altVerifiedText: {fontSize: type.caption, fontWeight: '700', marginTop: 4},

  altApplyRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: flow.line,
  },
  altApplyText: {fontSize: type.caption, color: flow.inkDim, fontWeight: '700'},

  altFooterHint: {fontSize: type.caption, color: flow.inkFaint, marginTop: 4, marginBottom: spacing.sm},
});
