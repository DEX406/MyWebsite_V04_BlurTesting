import { FONT } from '../constants.js';
import { panelSurface, Z } from '../styles.js';

export function LoginModal({ showLogin, setShowLogin, password, setPassword, loginError, setLoginError, handleLogin, rateLimited, setRateLimited }) {
  if (!showLogin) return null;

  const isLocked = rateLimited && rateLimited > 0;
  const minutes = isLocked ? Math.ceil(rateLimited / 60) : 0;

  return (
    <div onClick={() => { setShowLogin(false); setLoginError(false); setRateLimited(null); setPassword(""); }}
      style={{ position: "absolute", inset: 0, background: "#000000", display: "flex", alignItems: "center", justifyContent: "center", zIndex: Z.MODAL }}>
      <div onClick={e => e.stopPropagation()} style={{ ...panelSurface, padding: 24, width: 280 }}>
        <div style={{ color: "rgba(194,192,182,0.35)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16, fontFamily: FONT }}>Admin</div>
        <input type="password" placeholder="Password" value={password}
          onChange={e => { setPassword(e.target.value); setLoginError(false); }}
          onKeyDown={e => e.key === "Enter" && !isLocked && handleLogin()} autoFocus disabled={isLocked}
          style={{ width: "100%", padding: "8px 11px", background: "rgba(194,192,182,0.06)", border: (loginError || isLocked) ? "1px solid rgba(254,129,129,0.7)" : "1px solid rgba(194,192,182,0.08)", borderRadius: 6, color: "rgba(194,192,182,0.88)", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: FONT, opacity: isLocked ? 0.5 : 1 }} />
        {loginError && <p style={{ color: "rgba(254,129,129,0.85)", fontSize: 11, margin: "5px 0 0", fontFamily: FONT }}>Wrong password</p>}
        {isLocked && <p style={{ color: "rgba(254,129,129,0.85)", fontSize: 11, margin: "5px 0 0", fontFamily: FONT }}>Too many attempts. Try again in {minutes} min.</p>}
        <button onClick={handleLogin} disabled={isLocked} style={{ width: "100%", marginTop: 12, padding: "9px 0", background: isLocked ? "rgba(44,132,219,0.3)" : "#2C84DB", color: "#141413", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: isLocked ? "not-allowed" : "pointer", fontFamily: FONT }}>Enter</button>
      </div>
    </div>
  );
}
