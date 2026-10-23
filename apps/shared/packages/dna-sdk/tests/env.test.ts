import assert from "node:assert/strict";
import { test } from "node:test";
import { fillFromKeychain, keychainSpec } from "../src/node/env.ts";

test("keychainSpec reads VAR=service pairs and skips malformed ones", () => {
  assert.deepEqual(keychainSpec(" A_KEY = svc-a ,B_KEY=svc-b,broken,=x,C="), [
    ["A_KEY", "svc-a"],
    ["B_KEY", "svc-b"],
  ]);
  assert.deepEqual(keychainSpec(""), []);
});

test("fillFromKeychain fills only unset variables and never overwrites a set one", () => {
  const asked: string[] = [];
  const lookup = (service: string) => {
    asked.push(service);
    return service === "missing" ? undefined : `secret-for-${service}`;
  };
  const env: NodeJS.ProcessEnv = {
    DNA_KEYCHAIN: "A_KEY=svc-a,B_KEY=svc-b,C_KEY=missing",
    B_KEY: "already-set",
  };
  assert.deepEqual(fillFromKeychain(env, lookup), ["A_KEY"]);
  assert.equal(env.A_KEY, "secret-for-svc-a");
  assert.equal(env.B_KEY, "already-set");
  assert.equal(env.C_KEY, undefined);
  assert.deepEqual(asked, ["svc-a", "missing"]);
});
