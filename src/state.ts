/**
 * Manages the state of the game.
 *
 * All interactions within the state are handled here.
 * All calculations, reduction, movement and other game actions are handled in this file.
 *
 * @author William Keeble
 */

/////////////// [IMPORTS AND EXPORTS] ////////////////////

import { Observable, Subscription, take, takeLast } from "rxjs";
import {
  Action,
  Constants,
  Cube,
  Offset,
  Piece,
  State,
  Viewport,
} from "./types";
import {
  RNG,
  calculateScore,
  collidedX,
  collidedY,
  difference,
  modulo,
  validPosition,
} from "./util";
import { clearView, updateHighScore, updateView } from "./view";
import { filter, scan } from "rxjs/operators";

export {
  initialState,
  reduceState,
  Move,
  Tick,
  Rotate,
  AddPiece,
  NewGame,
  createPiece,
};

/////////////// [INITIAL STATE] ////////////////////

// Initial coordinates for use in spawning new pieces.
const INITIAL_COORDS = { x: 60, y: -40 };

// The initial piece. Arbitrary placeholder.
const INITIAL_PIECE: Piece = {
  cubes: [],
  shape: "O",
  rotationIndex: 0,
};

// The initial state.
const initialState: State = {
  gameEnd: false,
  currentId: 0,
  piece: INITIAL_PIECE,
  nextPiece: INITIAL_PIECE,
  staticCubes: [],
  exit: [],
  score: 0,
  fallRateMs: 300,
  level: 1,
  levelProgress: 0,
  highScore: 0,
  tickProgress: 0,
} as const;

/////////////// [PIECE CREATION] ////////////////////

/**
 * Creates a new piece, based on the current state and a given piece type.
 *
 * @param s The state.
 * @param pType The type of piece to create.
 * @returns The new piece.
 */
const createPiece =
  (s: State) =>
  (pType: string): Piece => {
    /**
     * Creates a single cube for use in the piece.
     * @param cColour The colour of the cube.
     * @returns The new cube.
     */
    const createCube =
      (cColour: string) =>
      (cId: number) =>
      (cX: number, cY: number): Cube => {
        return <Cube>{
          id: cId,
          x: cX,
          y: cY,
          colour: cColour,
        };
      };

    // Curried functions for each cube colour.
    const cyanCube = createCube("cyan"),
      blueCube = createCube("blue"),
      orangeCube = createCube("orange"),
      yellowCube = createCube("yellow"),
      greenCube = createCube("green"),
      purpleCube = createCube("purple"),
      redCube = createCube("red");

    /**
     * Builds the new shape, based on a cube builder.
     * Takes in a cube builder function (e.g., cyanCube),
     * returning the piece of that colour.
     *
     * @param builder The cube builder.
     * @returns The new piece.
     */
    const buildShape =
      (builder: Function) =>
      /**
       * Takes in the offsets for each piece type, putting them together
       * into a new piece.
       *
       * @param xOffset1..4 The x offsets for each cube.
       * @param yOffset1..4 The y offsets for each cube.
       * @returns The new piece.
       */
      (xOffset1: number, yOffset1: number) =>
      (xOffset2: number, yOffset2: number) =>
      (xOffset3: number, yOffset3: number) =>
      (xOffset4: number, yOffset4: number) =>
        [
          builder(s.currentId + 1)(
            INITIAL_COORDS.x + xOffset1 * Constants.CUBE_SIZE_PX,
            INITIAL_COORDS.y + yOffset1 * Constants.CUBE_SIZE_PX
          ),
          builder(s.currentId + 2)(
            INITIAL_COORDS.x + xOffset2 * Constants.CUBE_SIZE_PX,
            INITIAL_COORDS.y + yOffset2 * Constants.CUBE_SIZE_PX
          ),
          builder(s.currentId + 3)(
            INITIAL_COORDS.x + xOffset3 * Constants.CUBE_SIZE_PX,
            INITIAL_COORDS.y + yOffset3 * Constants.CUBE_SIZE_PX
          ),
          builder(s.currentId + 4)(
            INITIAL_COORDS.x + xOffset4 * Constants.CUBE_SIZE_PX,
            INITIAL_COORDS.y + yOffset4 * Constants.CUBE_SIZE_PX
          ),
        ];

    return pType === "I"
      ? <Piece>{
          cubes: buildShape(cyanCube)(0, 1)(0, 0)(0, 2)(0, 3),
          shape: "I",
          rotationIndex: 0,
        }
      : pType === "J"
      ? <Piece>{
          cubes: buildShape(blueCube)(1, 1)(0, 0)(0, 1)(2, 1),
          shape: "J",
          rotationIndex: 0,
        }
      : pType === "L"
      ? <Piece>{
          cubes: buildShape(orangeCube)(1, 1)(0, 1)(2, 1)(2, 0),
          shape: "L",
          rotationIndex: 0,
        }
      : pType === "O"
      ? <Piece>{
          cubes: buildShape(yellowCube)(0, 1)(0, 0)(1, 0)(1, 1),
          shape: "O",
          rotationIndex: 0,
        }
      : pType === "S"
      ? <Piece>{
          cubes: buildShape(greenCube)(1, 1)(0, 1)(1, 0)(2, 0),
          shape: "S",
          rotationIndex: 0,
        }
      : pType === "T"
      ? <Piece>{
          cubes: buildShape(purpleCube)(1, 1)(0, 1)(1, 0)(2, 1),
          shape: "T",
          rotationIndex: 0,
        }
      : <Piece>{
          cubes: buildShape(redCube)(1, 1)(0, 0)(1, 0)(2, 1),
          shape: "Z",
          rotationIndex: 0,
        };
  };

/////////////// [ACTION CLASSES] ////////////////////
class Move implements Action {
  /**
   * Moves a piece by a given number of pixels in the x and y directions.
   *
   * @param x Distance to move on the x-axis.
   * @param y Distance to move on the y-axis.
   */
  constructor(public readonly x: number, public readonly y: number) {}
  /**
   * Computes a new state based on the movement of the current piece.
   *
   * @param s The old state.
   * @returns The new state.
   */
  apply = (s: State): State => {
    return this.handleCollisions(s);
  };

  /**
   * Determines if a cube has hit the bottom of the viewport.
   *
   * @param c The cube.
   * @returns Has it hit the bottom?
   */
  static hitBottom = (c: Cube) =>
    c.y >= Viewport.CANVAS_HEIGHT - Constants.CUBE_SIZE_PX;

  /**
   * Checks if the current piece is in a valid X position.
   *
   * @param s The current state.
   * @returns Is the piece valid in the X axis?
   */
  validX = (s: State): boolean => {
    // Has the piece collided with the right side of the board?
    const atRight = s.piece.cubes.some(
      (c: Cube) => c.x + this.x > Viewport.CANVAS_WIDTH - Constants.CUBE_SIZE_PX
    );
    // Has the piece collided with the left side of the board?
    const atLeft = s.piece.cubes.some((c: Cube) => c.x + this.x < 0);
    // Has the piece collided with another cube horizontally?
    const pieceCollidedX = s.piece.cubes.some((c) =>
      s.staticCubes.some(collidedX(c))
    );
    return !pieceCollidedX && !atLeft && !atRight;
  };

  /**
   * Checks if the current piece is in a valid Y position.
   *
   * @param s The current state.
   * @returns Is the piece valid in the Y axis?
   */
  validY = (s: State): boolean => {
    const pieceHitBottom = s.piece.cubes.some(Move.hitBottom);
    const verticalCollision = s.piece.cubes.some((c) =>
      s.staticCubes.some(collidedY(c))
    );
    return !pieceHitBottom && !verticalCollision;
  };

  /**
   * Handles collisions with the piece and static cubes.
   *
   * @param s The state.
   * @returns A newly computed state.
   */
  handleCollisions = (s: State): State =>
    <State>{
      ...s,
      piece: <Piece>{
        ...s.piece,
        cubes: s.piece.cubes.map((cube: Cube) => {
          return {
            ...cube,
            x: cube.x + (this.validX(s) ? this.x : 0),
            y: cube.y + (this.validY(s) ? this.y : 0),
          };
        }),
      },
    };
}

class Rotate implements Action {
  /**
   * Rotates a piece.
   *
   * @param clockwise Are we moving clockwise?
   */
  constructor(public readonly clockwise: boolean) {}
  apply = (s: State): State => {
    if (s.piece.shape === "O") {
      return s;
    } else {
      return this.rotatePiece(s);
    }
  };

  /**
   * Rotates a piece, given a state.
   * @param s The state.
   * @returns The new state, with the piece rotated.
   */
  rotatePiece = (s: State): State => {
    // Calculate the new index of orientation, based on whether we are going
    // clockwise or not. The module keeps it within range [0, 4].
    const newRotationIndex = modulo(
      this.clockwise ? s.piece.rotationIndex + 1 : s.piece.rotationIndex - 1,
      4
    );

    // This rotates each cube.
    // Note that the rotation centers around the first cube in the array.
    const newCubes = s.piece.cubes.map((c) =>
      this.rotateCube(c, this.clockwise)(s.piece.cubes[0].x, s.piece.cubes[0].y)
    );

    // Check if the piece is in a valid place after rotation.
    const unobstructed = newCubes.every(validPosition(s));

    const newPiece = <Piece>{
      ...s.piece,
      cubes: newCubes,
      rotationIndex: newRotationIndex,
    };
    const newState = <State>{
      ...s,
      piece: newPiece,
    };

    // If it is un-obstructed, we can return here,
    if (unobstructed) {
      return newState;
    }

    // If the piece is obstructed, we check for potential wall kick positions.
    const validOffsets = this.checkOffsets(newState)(newRotationIndex);

    if (validOffsets.length > 0) {
      // If we have a valid wall kick, we perform the first valid kick we find.
      const offSetData = validOffsets[0],
        moveX = offSetData[0] * Constants.CUBE_SIZE_PX,
        moveY = offSetData[1] * Constants.CUBE_SIZE_PX,
        movePiece = new Move(moveX, moveY),
        finalState = movePiece.apply({
          ...newState,
          piece: <Piece>{
            ...newState.piece,
            rotationIndex: newRotationIndex,
          },
        });
      return finalState;
    }

    // If none of the wall kicks are valid, we cancel the rotation.
    return s;
  };

  /**
   * Rotates a tile 90 degrees around the center (origin) cube.
   * @param c The cube to be rotated.
   * @param clockwise Are we rotating clockwise?
   * @param originX The x-coord of the origin cube
   * @param originY The y-coord of the origin cube
   * @returns A repositioned cube
   */
  rotateCube =
    (c: Cube, clockwise: boolean) =>
    (originX: number, originY: number): Cube => {
      // Coordinates relative to the center (origin) cube
      const relativeX = c.x - originX;
      const relativeY = c.y - originY;

      // Rotation matrix dependent on if we are rotating clockwise or not
      const rotationMatrix = clockwise
        ? [
            [0, -1],
            [1, 0],
          ]
        : [
            [0, 1],
            [-1, 0],
          ];

      // Calculate new positions based on the rotation matrix
      const newX =
        rotationMatrix[0][0] * relativeX + rotationMatrix[1][0] * relativeY;
      const newY =
        rotationMatrix[0][1] * relativeX + rotationMatrix[1][1] * relativeY;

      // Return the newly positioned cube - coordinates back to global.
      return {
        ...c,
        x: newX + originX,
        y: newY + originY,
      };
    };

  /**
   * Checks offset tests to find a valid wall kick position.
   * If we don't find one, we do not rotate.
   *
   * @param s The state.
   * @param newRotationIndex The rotation index to change to.
   * @returns All valid offsets that we can rotate to.
   */
  checkOffsets =
    (s: State) =>
    (newRotationIndex: number): number[][] => {
      // Gets the offset data from the Offset class.
      const offsetData = Offset.getOffset(s.piece.shape);

      // Try to find a valid place to put the piece.
      const INVALID_OFFSET = 999; // Placeholder for invalid offsets.
      const offsetCalcs = offsetData
        .map((test: number[][]) => {
          // For each "test", we test if we can rotate into that position.
          // The new positions are given by the offset from the original postition.
          const startOffset = test[s.piece.rotationIndex],
            endOffset = test[newRotationIndex], // Get the offsets from the test
            // Calculate end offsets.
            finalOffsetX = startOffset[0] - endOffset[0],
            finalOffsetY = startOffset[1] - endOffset[1],
            canMove = this.validOffset(s)(finalOffsetX, finalOffsetY); // Check if we can move.
          return canMove
            ? [finalOffsetX, finalOffsetY]
            : [INVALID_OFFSET, INVALID_OFFSET];
        })
        .filter((val) => {
          // Only allow valid rotations.
          val[0] !== INVALID_OFFSET && val[1] !== INVALID_OFFSET;
        });
      return offsetCalcs; //
    };

  /**
   * Checks if an offset is valid. i.e., if we offset
   * a piece by the given coords, will it be in a
   * position with no collisions?
   *
   * @param s The state.
   * @param offsetX X value to offset by.
   * @param offsetY Y value to offset by.
   * @returns Is the offset into a valid position?
   */
  validOffset =
    (s: State) =>
    (offsetX: number, offsetY: number): boolean => {
      // Temporarily moves the cubes.
      const movedCubes = s.piece.cubes.map(
        (c) =>
          <Cube>{
            ...c,
            x: c.x + offsetX * Constants.CUBE_SIZE_PX,
            y: c.y + offsetY * Constants.CUBE_SIZE_PX,
          }
      );
      // Checks if all the cubes are in a valid position.
      return movedCubes.every(validPosition(s));
    };
}

class Tick implements Action {
  /**
   * The main tick action.
   * Most of the computation occurs here.
   *
   * @param elapsed How much time has elapsed between ticks?
   */
  constructor(public readonly elapsed: number) {}
  /**
   * Applies the tick.
   * @param s The state.
   * @returns The new state.
   */
  apply = (s: State): State => {
    const checkRemoveRows = Tick.removeFullRows(s),
      checkMoveDown = this.autoMoveDown(checkRemoveRows),
      checkLevels = Tick.levelCheck(checkMoveDown),
      checkGameOver = Tick.gameOver(checkLevels);
    return checkGameOver;
  };

  /**
   * Remove all full rows from the board.
   * @param s
   * @returns
   */
  static removeFullRows = (s: State): State => {
    // Checks if a row that contains a given cube is full, based on cube height
    const checkRow = (cube: Cube) =>
        s.staticCubes.filter((c) => c.y === cube.y).length ===
        Constants.ROW_WIDTH,
      // All cubes in full rows (to be removed)
      exitCubes = s.staticCubes.filter(checkRow),
      numRowsRemoved = Math.floor(exitCubes.length / Constants.ROW_WIDTH),
      // The lowest y coordinate of cubes that are removed.
      // So, we must move cubes above this down.
      moveAboveY = Math.max(...exitCubes.map((x) => x.y)),
      // Cubes that are not removed
      newCubes = difference(s.staticCubes)(exitCubes),
      // Cubes that need to be shifted down
      cubesToShift = newCubes.filter((c) => c.y < moveAboveY),
      // Those cubes are moved down
      shiftedCubes = cubesToShift.map(
        (c) =>
          <Cube>{
            ...c,
            y: c.y + numRowsRemoved * Constants.CUBE_SIZE_PX,
          }
      ),
      // All of the cubes that were not removed, with those shifted that needed to be.
      cubesOut = difference(newCubes)(cubesToShift).concat(shiftedCubes);
    return {
      ...s,
      staticCubes: cubesOut,
      exit: exitCubes,
      score: s.score + calculateScore(numRowsRemoved),
      levelProgress: s.levelProgress + numRowsRemoved,
    };
  };

  /**
   * This is where we "confirm" that a piece has collided vertically.
   * The reason we do not compute this in the Move directly, is to
   * allow time within the tick to let the user "slide" the piece into
   * a position that they could not otherwise.
   *
   * We only call this when the auto down movement is occurring, so that
   * the user has enough time to slide into position. If we called this
   * every tick, the user would not be able to slide in time.
   *
   * @param s The state.
   * @returns Newly computed state.
   */
  static filterVerticallyCollided = (s: State): State => {
    // Has the piece vertically collided with the bottom of the
    // viewport or a static cube?
    const pieceHitBottom = s.piece.cubes.some(Move.hitBottom),
      verticalCollision =
        s.piece.cubes.some((c) => s.staticCubes.some(collidedY(c))) ||
        pieceHitBottom;
    return {
      ...s,
      piece: <Piece>{
        ...s.piece,
        cubes: verticalCollision ? [] : s.piece.cubes,
      },
      staticCubes: verticalCollision
        ? s.staticCubes.concat(s.piece.cubes)
        : s.staticCubes,
    };
  };

  /**
   * Checks whether we need to level up.
   * If we do, update the state and increase the falling speed.
   * The falling speed has a limit of 100ms.
   * @param s The old state.
   * @returns The new state.
   */
  static levelCheck = (s: State): State => {
    return s.levelProgress >= Constants.LEVEL_GOAL
      ? <State>{
          ...s,
          level: s.level + 1,
          levelProgress: 0,
          fallRateMs:
            s.fallRateMs > Constants.FALL_RATE_LIMIT_MS
              ? Constants.START_FALL_RATE_MS - 25 * s.level
              : s.fallRateMs,
        }
      : s;
  };

  /**
   * Checks whether the blocks have reached the top of the screen.
   * If they have, initialise a game over.
   * Also updates the high score if needed.
   * @param s The old state.
   * @returns The new state.
   */
  static gameOver = (s: State): State => {
    const gameIsOver = s.staticCubes.filter((c: Cube) => c.y <= 0).length > 0;
    const newHighScore = s.score > s.highScore ? s.score : s.highScore;
    return gameIsOver
      ? <State>{
          ...initialState,
          gameEnd: true,
          highScore: newHighScore,
        }
      : s;
  };

  /**
   * Automatically moves the piece down if the the tickrate
   * has crossed the threshold to move to the next down movement.
   * We also only vertically collide here, as we want to be able to
   * "slide" the piece into gaps.
   * @param s
   * @returns
   */
  autoMoveDown = (s: State): State => {
    const newElapsed = s.tickProgress + Constants.TICK_RATE_MS;
    if (newElapsed >= s.fallRateMs) {
      const filteredState = Tick.filterVerticallyCollided(s),
        resetTickProgress = <State>{ ...filteredState, tickProgress: 0 },
        newMove = new Move(0, Constants.CUBE_SIZE_PX),
        appliedState = newMove.apply(resetTickProgress);
      return appliedState;
    } else {
      return <State>{
        ...s,
        tickProgress: newElapsed,
      };
    }
  };
}

class AddPiece implements Action {
  /**
   * Adds a new piece to the board.
   *
   * @param shape The shape of piece to add.
   */
  constructor(readonly shape: string) {}
  /**
   * Applies the new piece.
   * @param s The state.
   * @returns New state.
   */
  apply = (s: State): State => this.nextPiece(s);

  /**
   * Computes the next piece, calling the createPiece function.
   * @param s The state.
   * @returns New state.
   */
  nextPiece = (s: State): State =>
    // We only need a new piece if the current piece is empty -> collided vertically.
    s.piece.cubes.length === 0
      ? {
          ...s,
          currentId: s.currentId + Constants.PIECE_SIZE,
          piece: s.nextPiece,
          nextPiece: createPiece({
            ...s,
            currentId: s.currentId + 2 * Constants.PIECE_SIZE,
          })(this.shape),
        }
      : {
          ...s,
        };
}

class NewGame implements Action {
  /**
   * Starts a new game.
   * @param stream All of the source streams to utilise in the game.
   */
  constructor(public readonly stream: Observable<Action>) {}
  /**
   * Applies the new game.
   * @param s The state.
   * @returns New state.
   */
  apply = (s: State) => {
    // Reduce the source stream -> this is where all of the movement occurs.
    const source$ = this.stream.pipe(scan(reduceState, s));
    const subscription: Subscription = source$.subscribe(
      updateView(() => subscription.unsubscribe())
    );
    const endState = source$
      .pipe(
        filter((s: State) => s.gameEnd),
        take(1) // We only need to take the last state for the high score.
      )
      // Update the high score at the end of each round. only updated when the new
      // score is higher.
      .subscribe((s: State) => updateHighScore(s.highScore));
    return s;
  };
}

//////////////// STATE UPDATES //////////////////////
// Reduces state -> all state updates hinge on this.
const reduceState = (s: State, action: Action) => action.apply(s);
