import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, write, read } from './helpers';
import { validateProfile } from '../src/profile';
import { codex } from '../src/clients/codex';
import { disableTelemetry } from '../src/clients/telemetry';

const inherited = {
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', OTEL_EXPORTER_OTLP_HEADERS: 'token=dummy',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:1/traces', OTEL_SDK_DISABLED: 'false',
  CLAUDE_CODE_ENABLE_TELEMETRY: '1', CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL: '1',
  ENABLE_BETA_TRACING_DETAILED: '1', BETA_TRACING_ENDPOINT: 'http://127.0.0.1:1/beta',
};

test('telemetry profile policy accepts only false or omission', t => {
  const f = fixture(t);
  assert.equal(validateProfile(f.a).telemetry, false);
  const old = { ...f.a }; delete old.telemetry;
  assert.equal(validateProfile(old).telemetry, undefined);
  for (const value of [true, 'false', null, 0, {}, []]) {
    assert.throws(() => validateProfile({ ...old, telemetry: value }), /telemetry/);
  }
});

test('telemetry environment removes all inherited destinations including Windows casing', () => {
  const env: Record<string, string> = { ...inherited, otel_exporter_otlp_endpoint: 'old', disable_telemetry: '', KEEP: 'yes' };
  disableTelemetry(env);
  assert.equal(env.KEEP, 'yes');
  assert.equal(env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
  assert.equal(env.otel_exporter_otlp_endpoint, undefined);
  assert.equal(env.disable_telemetry, undefined);
  assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, undefined);
  assert.equal(env.OTEL_SDK_DISABLED, 'true');
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '0');
  assert.equal(env.BETA_TRACING_ENDPOINT, '');
});

test('launch overrides old telemetry settings and removes owned fields when policy is removed', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  const root = path.join(f.home, 'devn/profiles/a');
  fs.mkdirSync(path.join(root, 'codex'), { recursive: true });
  fs.writeFileSync(path.join(root, 'codex/config.toml'), Bun.TOML.stringify({
    analytics: { enabled: true }, feedback: { enabled: true },
    otel: { exporter: { 'otlp-http': { endpoint: inherited.OTEL_EXPORTER_OTLP_ENDPOINT } }, log_user_prompt: true },
    history: { persistence: 'save-all' },
  }));
  write(path.join(root, 'claude/settings.json'), { env: { ...inherited, PERSONAL: 'keep' } });
  for (const tool of ['codex', 'claude']) {
    const result = f.run([tool], { env: { ...f.env, ...inherited } });
    assert.equal(result.status, 0, result.stderr);
    const capture = read(f.capture);
    assert.equal(capture.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
    assert.equal(capture.env.DISABLE_ERROR_REPORTING, '1');
    assert.equal(capture.env.CLAUDE_CODE_ENABLE_TELEMETRY, '0');
    if (tool === 'codex') {
      const config: any = Bun.TOML.parse(capture.config);
      assert.ok(capture.args.includes('analytics.enabled=false'));
      assert.equal(config.analytics.enabled, false);
      assert.equal(config.feedback.enabled, false);
      assert.deepEqual(config.otel, { exporter: 'none', metrics_exporter: 'none', trace_exporter: 'none', log_user_prompt: false });
      assert.equal(config.history.persistence, 'save-all');
    } else {
      const config = JSON.parse(capture.config);
      assert.equal(config.env.OTEL_EXPORTER_OTLP_ENDPOINT, '');
      assert.equal(config.env.OTEL_SDK_DISABLED, 'true');
      assert.equal(config.env.DISABLE_TELEMETRY, '1');
      assert.equal(config.env.PERSONAL, 'keep');
    }
  }
  delete f.a.telemetry;
  write(path.join(root, 'profile.json'), f.a);
  for (const tool of ['codex', 'claude']) {
    const result = f.run([tool], { env: { ...f.env, ...inherited } });
    assert.equal(result.status, 0, result.stderr);
    const capture = read(f.capture);
    assert.equal(capture.env.OTEL_EXPORTER_OTLP_ENDPOINT, inherited.OTEL_EXPORTER_OTLP_ENDPOINT);
    if (tool === 'codex') {
      const config: any = Bun.TOML.parse(capture.config);
      assert.equal(config.analytics?.enabled, undefined);
      assert.equal(config.otel?.exporter, undefined);
      assert.equal(config.history.persistence, 'save-all');
    } else {
      const config = JSON.parse(capture.config);
      assert.equal(config.env.DISABLE_TELEMETRY, undefined);
      assert.equal(config.env.PERSONAL, 'keep');
    }
  }
});

test('Codex rejects telemetry config overrides including parent tables and compact flags', t => {
  const f = fixture(t);
  for (const args of [
    ['-c', 'analytics.enabled=true'], ['--config=feedback.enabled=true'],
    ['-cotel.exporter="otlp-http"'], ['-c', 'otel={exporter="none"}'],
    ['-c', 'analytics . enabled = true'], ['-c', '"\\u0061nalytics".enabled=true'],
    ['-c', 'analytics={enabled=true}'], ['-c', '"feedback".enabled=true'],
  ]) assert.throws(() => codex.checkArgs(args, f.a), /Telemetry/);
  assert.doesNotThrow(() => codex.checkArgs(['-c', 'history.persistence="none"'], f.a));
  assert.doesNotThrow(() => codex.checkArgs(['--', '-c', 'analytics.enabled=true'], f.a));
  const old = { ...f.a }; delete old.telemetry;
  assert.doesNotThrow(() => codex.checkArgs(['-c', 'analytics.enabled=true'], old));
});
