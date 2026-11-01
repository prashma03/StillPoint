/** Mutable view state read by the 3D frame loop. Avoids a React render per mouse move. */
export const homeView = {
  story: 0,
  slider: 0,
  lookX: 0,
  lookY: 0,
  lookTouch: 0,
  alignAt: 0,
  holdAlign: false,
  holdStory: 0,
  reduced: false,
}
