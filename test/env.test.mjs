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
