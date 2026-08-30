// Verifies the things that silently broke on Linux: tray icons that decode,
// a Tray that constructs, and secret storage that round-trips through whichever
// tier is available on this machine.
import fs from "fs";
import { app, nativeImage, safeStorage, Tray } from "electron";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = [];
const ok = (n, c, extra = "") =>
  out.push(`${c ? "PASS" : "FAIL"}  ${n}${extra ? " — " + extra : ""}`);

app.setName("Echo");

app.whenReady().then(async () => {
  try {
    for (const f of ["tray.png", "trayTemplate.png", "icon.png"]) {
      const img = nativeImage.createFromPath(join(root, "assets", f));
      const s = img.getSize();
      ok(`icon ${f} decodes`, !img.isEmpty(), `${s.width}x${s.height}`);
    }

    try {
      const t = new Tray(nativeImage.createFromPath(join(root, "assets", "tray.png")));
      ok("Tray constructs", true);
      t.destroy();
    } catch (e) {
      ok("Tray constructs", false, e.message);
    }

    const { setSecret, getSecret, deleteSecret, secretsStatus } = await import(
      join(root, "secrets.js")
    );
    const acct = "__echo_selftest__";

    const w = await setSecret(acct, "sk-test-12345");
    ok("setSecret succeeds", w.ok, `backend=${w.backend}`);
    ok("getSecret round-trips", (await getSecret(acct)) === "sk-test-12345");
    await deleteSecret(acct);
    ok("deleteSecret clears", (await getSecret(acct)) === "");
    ok(
      "short keys are stored (regression: <=10 chars were dropped)",
      (await setSecret(acct, "abc")).ok && (await getSecret(acct)) === "abc"
    );
    await deleteSecret(acct);

    // Prove the cache really shortcuts the backend: stash a value, remove it
    // behind the cache's back, and confirm reads still succeed. Every backend
    // read is a possible macOS keychain prompt, so this is the property that
    // keeps Echo from asking for a password on every request.
    const st0 = await secretsStatus();
    await setSecret(acct, "cached-value");
    await getSecret(acct); // warm
    if (st0.backend === "keychain") {
      const kt = (await import("keytar")).default;
      await kt.deletePassword("com.eduten.echo", acct);
    } else {
      const fs2 = await import("fs");
      const os2 = await import("path");
      const f = os2.join(app.getPath("userData"), "secrets.json");
      const j = JSON.parse(fs2.readFileSync(f, "utf8"));
      delete j[acct];
      fs2.writeFileSync(f, JSON.stringify(j));
    }
    ok("cached read does not hit the backend", (await getSecret(acct)) === "cached-value");
    ok("refresh bypasses the cache", (await getSecret(acct, { refresh: true })) === "");
    await deleteSecret(acct);

    const st = await secretsStatus();
    ok("secretsStatus reports a tier", !!st.label, st.label);
    ok("safeStorage probe does not throw", typeof safeStorage.isEncryptionAvailable() === "boolean");
  } catch (e) {
    ok("suite completed", false, e?.stack || String(e));
  }

  const failed = out.some((l) => l.startsWith("FAIL"));
  fs.writeFileSync(1, out.join("\n") + "\n");
  app.exit(failed ? 1 : 0);
});
