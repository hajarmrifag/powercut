// Temporary, not part of the shipped app: on-device timing harness for the
// Phase A TypeScript engine port. Swapped in via index.js only for the
// benchmark run recorded in docs/ENGINE_BENCHMARKS.md, then reverted.
//
// Yields to the JS event loop between every single iteration (not just
// between categories) -- an earlier version of this harness ran each
// category as one tight synchronous loop and was killed by the platform
// partway through the heaviest category (worst-case repair search x20),
// almost certainly an ANR-style watchdog on the blocked JS thread. That
// is itself a real finding, documented in docs/ENGINE_BENCHMARKS.md: it's
// exactly why src/api.ts defers each *single* engine call rather than
// assuming a single call is automatically safe. Per-iteration yielding
// here both avoids re-tripping that watchdog and produces the number that
// actually matters -- a single realistic call's latency, since a real
// button press triggers exactly one buildPlan() call, never a tight loop
// of them.
import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {buildPlan, defaultConfig} from './engine';

type Row = {label: string; n: number; medianMs: number; p95Ms: number; maxMs: number};

function yieldToUi(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function timeitAsync(label: string, n: number, fn: () => void): Promise<Row> {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    fn();
    await yieldToUi();
  }
  for (let i = 0; i < n; i++) {
    const start = Date.now();
    fn();
    times.push(Date.now() - start);
    await yieldToUi();
  }
  times.sort((a, b) => a - b);
  return {
    label,
    n,
    medianMs: times[Math.floor(n / 2)],
    p95Ms: times[Math.floor(n * 0.95)],
    maxMs: times[n - 1],
  };
}

export const BenchmarkScreen = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [wall, setWall] = useState<number | null>(null);
  const [phase, setPhase] = useState('starting');

  useEffect(() => {
    (async () => {
      const wallStart = Date.now();
      const push = async (label: string, n: number, fn: () => void) => {
        setPhase(label);
        await yieldToUi();
        const row = await timeitAsync(label, n, fn);
        setRows(prev => [...prev, row]);
      };

      await push('defaultConfig() x10', 10, () => {
        defaultConfig();
      });

      await push('feasible plan (laptop=1h) x10', 10, () => {
        buildPlan(1800, 200, {laptop: 1});
      });

      await push('default infeasible, 1 repair tier x10', 10, () => {
        buildPlan(1800, 200, {});
      });

      // Worst case: forces both the protects_essentials tier AND the
      // requires_compromise fallback tier to run their full single+pair
      // search (usable_wh=1300 with every appliance at its maximum hours,
      // same scenario as the 'forces_compromise_tier' differential case).
      await push('worst-case repair search (both tiers) x10', 10, () => {
        buildPlan(1300, 200, {
          fridge: 12,
          router: 12,
          lamp: 4,
          phone: 1,
          laptop: 3,
          fan: 4,
        });
      });

      setPhase('done');
      setWall(Date.now() - wallStart);
    })();
  }, []);

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.title}>Engine benchmark (on-device)</Text>
      <Text style={styles.row}>phase: {phase}</Text>
      {rows.map(r => (
        <View key={r.label} style={styles.card}>
          <Text style={styles.label}>{r.label}</Text>
          <Text style={styles.row}>
            median {r.medianMs}ms / p95 {r.p95Ms}ms / max {r.maxMs}ms / n={r.n}
          </Text>
        </View>
      ))}
      {wall !== null && <Text style={styles.row}>Total wall time: {wall}ms</Text>}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#0B0F1C', padding: 40},
  title: {color: 'white', fontSize: 32, fontWeight: 'bold', marginBottom: 24},
  card: {marginBottom: 20, padding: 16, backgroundColor: '#1C2541', borderRadius: 12},
  label: {color: '#FFB347', fontSize: 22, marginBottom: 8},
  row: {color: 'white', fontSize: 20},
});
