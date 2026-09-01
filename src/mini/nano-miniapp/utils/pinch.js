// Two-finger pinch → discrete step detector.
//
// Shared by the health tab (a method on the user-health component) and the chat tab (a
// method on pages/main), so the two can't drift into behaving differently under the same
// gesture. Kept deliberately dumb: it reports a direction and nothing else — deciding what
// a step *means*, clamping it to a range, and persisting it all belong to the caller.
//
// Bind the returned handlers with `bind`, not `catch`: the host pages' edge-swipe handlers
// need to keep seeing the touch stream, and they guard themselves against multi-touch.

const DEFAULTS = {
  // Below this spread the two contact points are close enough that the ratio is dominated
  // by noise — two thumbs resting together should not resize anything.
  minSpread: 40,
  out: 1.25,   // spread ratio that counts as a deliberate pinch-out
  in: 0.8,     // ...and pinch-in
}

function distance(touches) {
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// onStep(dir) is called at most ONCE per gesture, with +1 (out) or -1 (in).
function createPinchStepper(onStep, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})
  let d0 = 0
  let fired = false

  return {
    start(e) {
      // WeChat fires touchstart once per finger added, so the second finger's event is the
      // one that arrives with length 2 — no first-finger bookkeeping needed.
      if (!e || !e.touches || e.touches.length !== 2) { d0 = 0; return }
      const spread = distance(e.touches)
      d0 = spread > o.minSpread ? spread : 0
      fired = false
    },

    move(e) {
      if (!d0 || fired) return
      if (!e || !e.touches || e.touches.length !== 2) return
      const r = distance(e.touches) / d0
      const dir = r >= o.out ? 1 : (r <= o.in ? -1 : 0)
      if (!dir) return
      fired = true   // latch: one step per gesture, however far it keeps going
      onStep(dir)
    },

    end() {
      d0 = 0
      fired = false
    },
  }
}

module.exports = { createPinchStepper, distance }
