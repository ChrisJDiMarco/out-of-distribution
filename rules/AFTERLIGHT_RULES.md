# Afterlight: complete rules

Afterlight is a two-player strategy game for **Amber** and **Blue**. Eight neutral sparks of light travel across a 6×6 board of switches. Players steer the light by flipping switches. Amber collects sparks that leave the board across the west edge; Blue collects sparks that leave across the east edge. The first player to collect 5 sparks wins.

## The board

- Columns **A to F** run from west (left) to east (right). Rows **1 to 6** run from north (top) to south (bottom). A1 is the north-west corner and F6 is the south-east corner.
- **Amber's collector** is the entire west edge, just outside column A. **Blue's collector** is the entire east edge, just outside column F.
- The north edge (above row 1) and the south edge (below row 6) are **walls**.
- Every cell holds a **switch** in one of two positions, written `\` and `/`. Each switch contains two curved tracks:
  - `\` joins the cell's **north side with its east side**, and its **south side with its west side**.
  - `/` joins the cell's **north side with its west side**, and its **south side with its east side**.
- A spark moves through a switch the way light bounces off a mirror of the same shape:

  | Heading into the cell | on `\` it leaves heading | on `/` it leaves heading |
  |---|---|---|
  | south (entered through the north side) | east | west |
  | north (entered through the south side) | west | east |
  | east (entered through the west side) | south | north |
  | west (entered through the east side) | north | south |

## Sparks

- There are eight sparks. They are neutral: neither player owns them.
- A spark always sits inside one cell, just inside the side it entered through. Its **heading** is the direction it was travelling when it entered. A spark that entered through the north side is heading south.
- Two sparks may share a cell.

## A turn

Players alternate turns. **Amber takes the first turn.** On your turn you do exactly one of these:

1. **Flip** one switch in a cell that contains **no spark** (`\` becomes `/`, `/` becomes `\`), or
2. **Pass**.

Then the light **advances**. Every spark on the board moves exactly once, all at the same time:

1. Each spark follows the track of the switch in the cell it is in, from the side it entered through to the side that track leads to, and leaves the cell through that side.
2. It enters the neighbouring cell on that side and keeps its new heading. It will not turn again until the next advance.
   - If it leaves across the **west edge**, Amber collects it: Amber scores 1 point and the spark is removed from the game.
   - If it leaves across the **east edge**, Blue collects it: Blue scores 1 point and the spark is removed.
   - If it would cross the **north or south wall**, it bounces: it stays in the same cell and now counts as having entered through that wall side. Its heading reverses.
3. After every spark has moved, each switch that a spark just departed **flips**. This includes a spark that was just collected, and a spark that bounced off a wall (it flips the switch in the cell it stayed in). The flips count per spark: if two sparks departed the same cell in one advance, that switch flips twice and ends up unchanged.

Two consequences follow from these rules:

- A spark only uses the switch in the cell it already occupies, and you may only flip an empty cell. **Your flip never changes the current advance.** It changes the route of any spark that later leaves the cell you flipped, including a spark that arrives there during this very advance.
- A cell that holds a spark cannot be flipped. Once an advance ends (including its flips) with a spark in a cell, that spark's next exit is already decided.

## End of the game

The game is checked after every advance:

- A player who reaches **5 points wins** immediately.
- If the score reaches **4–4** (all eight sparks collected), the game is a **draw**.
- If the same position occurs for the **third time**, the game is a **draw**. A position means all switches, every spark's cell and heading, the score, and the player about to move.
- In this league, a game that reaches 200 turns without a result is also a draw.

## The starting position

The starting switches and sparks are symmetric under a half-turn rotation of the board, so neither collector is favoured by the layout. Only the right to move first differs, so each pairing is played once with each player as Amber.
