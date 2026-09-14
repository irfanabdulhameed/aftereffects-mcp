# Legacy standalone scripts

These ten `.jsx` files came from the upstream repository's `src/scripts` folder. They were copied into `build/scripts` by the old build step, but nothing ever loaded them: the server never read them and the bridge panel carried its own copies of the same functions.

They are kept here for reference only. They are not part of the build, not linted, and not installed into After Effects. The live implementations are in `server/src/scripts/commands/`.
