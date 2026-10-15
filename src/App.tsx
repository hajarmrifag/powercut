import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView, useKeplerBackHandler} from '@amazon-devices/react-native-kepler';
import type {Alternative, Plan} from './types';

const HOST = 'http://10.0.2.2:8766';
type Page = 'root' | 'requested' | 'altA' | 'altB';

async function requestPlan(): Promise<Plan> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(HOST + '/plan', {signal: controller.signal});
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    return (await response.json()) as Plan;
  } finally {
    clearTimeout(timer);
  }
}

export const App = () => {
  const [page, setPage] = useState<Page>('root');
  const [focus, setFocus] = useState('Requested plan');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const backHandler = useKeplerBackHandler();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    requestPlan()
      .then(data => {
        setPlan(data);
        setLoading(false);
      })
      .catch(e => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const subscription = backHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'root') {
        setPage('root');
        return true;
      }
      return false;
    });
    return () => subscription?.remove();
  }, [backHandler, page]);

  const statusLine = loading
    ? 'Loading live plan from backend...'
    : error
    ? 'Backend error: ' + error
    : plan
    ? `${plan.outage_hours}h outage · requested plan is ` +
      (plan.requested.result.feasible ? 'FEASIBLE' : 'INFEASIBLE') +
      ` · live nonce ${plan.nonce}`
    : '';

  const altA = plan?.alternatives.find(a => a.id === 'A');
  const altB = plan?.alternatives.find(a => a.id === 'B');

  const tiles = [
    {
      label: 'Requested plan (INFEASIBLE)',
      testID: 'tile-requested',
      action: () => plan && setPage('requested'),
    },
    {
      label: altA ? `${altA.label} (FEASIBLE)` : 'Alternative A',
      testID: 'tile-alt-a',
      action: () => plan && setPage('altA'),
    },
    {
      label: altB ? `${altB.label} (FEASIBLE)` : 'Alternative B',
      testID: 'tile-alt-b',
      action: () => plan && setPage('altB'),
    },
    {
      label: 'Refresh plan from backend',
      testID: 'tile-refresh',
      action: load,
    },
  ];

  if (page === 'root') {
    return (
      <View style={styles.screen} testID="screen-root">
        <Text style={styles.title}>PowerCut</Text>
        <Text style={styles.subtitle}>{plan?.title ?? "Tonight's outage plan"}</Text>
        <Text style={styles.status}>{statusLine}</Text>
        <TVFocusGuideView style={styles.grid} autoFocus>
          {tiles.map((t, i) => (
            <Pressable
              key={t.label}
              testID={t.testID}
              hasTVPreferredFocus={i === 0}
              accessibilityLabel={t.label}
              onFocus={() => setFocus(t.label)}
              onPress={t.action}
              style={[styles.button, focus === t.label && styles.focused]}>
              <Text style={styles.buttonText}>{t.label}</Text>
            </Pressable>
          ))}
        </TVFocusGuideView>
        {plan && (
          <Text style={styles.footer}>{plan.limits}</Text>
        )}
      </View>
    );
  }

  if (page === 'requested' && plan) {
    const {requested} = plan;
    return (
      <ScrollView style={styles.screen} testID="screen-requested">
        <Text style={styles.title}>Requested plan — INFEASIBLE</Text>
        <Text style={styles.status}>
          Needs {requested.result.required_wh} Wh; battery has{' '}
          {requested.result.budget_wh} Wh (short by{' '}
          {(requested.result.required_wh ?? 0) - (requested.result.budget_wh ?? 0)} Wh)
        </Text>
        <Text style={styles.paragraph}>{requested.explanation}</Text>
        <Text style={styles.sectionTitle}>Requested appliance profiles</Text>
        {requested.problem.appliances.map(a => (
          <Text key={a.id} style={styles.text}>
            {a.id}: {a.low_w}-{a.high_w} W · {a.required_hours}h required · window hours{' '}
            {Math.min(...a.allowed_hours)}-{Math.max(...a.allowed_hours)}
          </Text>
        ))}
        <Text style={styles.footerHint}>Press Back to return</Text>
      </ScrollView>
    );
  }

  if ((page === 'altA' || page === 'altB') && plan) {
    const alt = page === 'altA' ? altA : altB;
    if (!alt) {
      return (
        <View style={styles.screen}>
          <Text style={styles.text}>Alternative not available.</Text>
        </View>
      );
    }
    return renderAlternative(alt);
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.text}>No plan loaded yet. Press Back to return.</Text>
    </View>
  );
};

function renderAlternative(alt: Alternative) {
  const v = alt.independent_verification;
  return (
    <ScrollView style={styles.screen} testID={`screen-${alt.id === 'A' ? 'alt-a' : 'alt-b'}`}>
      <Text style={styles.title}>Alternative {alt.id} — FEASIBLE</Text>
      <Text style={styles.subtitle}>{alt.label}</Text>
      <Text style={styles.status}>
        Fan {alt.fan_hours}h · Laptop {alt.laptop_hours}h · uses {alt.result.energy_wh} Wh ·{' '}
        {alt.result.remaining_wh} Wh left · peak {alt.result.peak_w} W
      </Text>
      <Text style={styles.paragraph}>
        Independently verified: {v?.valid ? 'PASS' : 'FAIL'}
        {v && v.errors.length > 0 ? ' — ' + v.errors.join(', ') : ''}. Fridge, router, lamp and
        phone protected hours preserved: {alt.protected_services_preserved ? 'yes' : 'no'}.
      </Text>
      <Text style={styles.sectionTitle}>Hour-by-hour schedule</Text>
      {v?.hourly.map(row => (
        <Text key={row.hour} style={styles.text}>
          h{row.hour}: {row.loads.join(', ') || 'none'} — {row.watts} W — {row.remaining_wh} Wh left
        </Text>
      ))}
      <Text style={styles.footerHint}>Press Back to return</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#101522', padding: 50},
  title: {fontSize: 44, color: 'white', fontWeight: 'bold', marginBottom: 8},
  subtitle: {fontSize: 26, color: '#b2e7c0', marginBottom: 8},
  status: {fontSize: 22, color: 'white', marginBottom: 16},
  paragraph: {fontSize: 21, color: '#dce2f0', lineHeight: 29, marginBottom: 20},
  sectionTitle: {fontSize: 24, color: '#ffb000', marginTop: 8, marginBottom: 10},
  text: {fontSize: 21, color: 'white', lineHeight: 28},
  footer: {fontSize: 17, color: '#8891a8', marginTop: 24},
  footerHint: {fontSize: 20, color: '#8891a8', marginTop: 24, marginBottom: 40},
  grid: {flexDirection: 'row', flexWrap: 'wrap', width: 1000, marginVertical: 20},
  button: {
    width: 460,
    height: 90,
    margin: 10,
    padding: 18,
    backgroundColor: '#30394b',
    borderWidth: 4,
    borderColor: '#30394b',
    justifyContent: 'center',
  },
  focused: {borderColor: '#ffb000'},
  buttonText: {fontSize: 22, color: 'white'},
});
