/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

import "./style.css";

import "./observable.ts";
import "./state.ts";
import "./view.ts";

import { Observable, Subscription, merge } from "rxjs";
import { scan } from "rxjs/operators";
import { initialState, reduceState} from "./state.ts";
import { initialiseView, updateView } from "./view.ts";
import { autoMoveDown$, moveAllDirections$, rotate$, tick$ } from "./observable.ts";
import { Action, State } from "./types.ts";

/** ==================== MAIN LOOP ==================== **/
/**
 * This is the function called on page load. Your main game loop
 * should be called here.
 */
export function main() {
  initialiseView();

    const action$: Observable<Action> = merge(tick$, moveAllDirections$, autoMoveDown$, rotate$),
    state$: Observable<State> = action$.pipe(scan(reduceState, initialState)),
    subscription: Subscription = state$.subscribe(updateView(() => subscription.unsubscribe()));
}

// The following simply runs your main function on window load.  Make sure to leave it in place.
if (typeof window !== "undefined") {
  window.onload = () => {
    main();
  };
}
