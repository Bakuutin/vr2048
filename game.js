AFRAME.registerComponent('tileboard', {
  dependencies: ['material'],
  schema: {
    size: {type: 'number', default: 4},
  },
  init: function() {
    this.actuator = new VRActuator(this.el);
    this.manager = new GameManager(
      this.data.size,
      this.actuator,
    );
    this.moved = true;
    this.onKeyDown = this.onKeyDown.bind(this);
  },
  tick: function () {
    if (this.moved) {
      this.moved = false;
      this.manager.actuate();
    }
  },
  remove: function () {
    this.removeEventListeners();
  },

  play: function () {
    this.attachEventListeners();
  },

  pause: function () {
    this.direction = null;
    this.removeEventListeners();
  },
  attachEventListeners: function () {
    window.addEventListener('keydown', this.onKeyDown);

  },
  removeEventListeners: function () {
    window.removeEventListener('keydown', this.onKeyDown);
  },

  move: function (direction) {
    // 0: up, 1: right, 2:down, 3: left
    this.moved = this.manager.move(direction);
  },

  onKeyDown: function (event) {
    if (!AFRAME.utils.shouldCaptureKeyEvent(event)) { return; }
    var map = {
      38: 0, // Up
      39: 1, // Right
      40: 2, // Down
      37: 3, // Left
    };
    var modifiers = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    var mapped = map[event.which];

    if (!modifiers) {
      if (mapped !== undefined) {
        this.move(mapped);
      }
    }
  },
});


class GameManager {
  constructor(size, actuator) {
    this.size = size; // Size of the grid
    this.actuator = actuator;
    this.startTiles = 2;
    this.setup();
  }
  // Restart the game
  restart() {
    this.actuator.restart();
    this.setup();
  }
  // Set up the game
  setup() {
    this.grid = new Grid(this.size);
    this.score = 0;
    this.over = false;
    this.won = false;
    // Add the initial tiles
    this.addStartTiles();
    // Update the actuator
    this.actuate();
  }
  // Set up the initial tiles to start the game with
  addStartTiles() {
    for (var i = 0; i < this.startTiles; i++) {
      this.addRandomTile();
    }
  }
  // Adds a tile in a random position
  addRandomTile() {
    if (this.grid.cellsAvailable()) {
      var value = Math.random() < 0.9 ? 2 : 4;
      var tile = new Tile(this.grid.randomAvailableCell(), value);
      this.grid.insertTile(tile);
    }
  }
  // Sends the updated grid to the actuator
  actuate() {
    this.actuator.actuate(this.grid, {
      score: this.score,
      over: this.over,
      won: this.won,
    });
  }
  // Save all tile positions and remove merger info
  prepareTiles() {
    this.grid.eachCell(function (x, y, tile) {
      if (tile) {
        tile.mergedFrom = null;
        tile.savePosition();
      }
    });
  }
  // Move a tile and its representation
  moveTile(tile, cell) {
    this.grid.cells[tile.x][tile.y] = null;
    this.grid.cells[cell.x][cell.y] = tile;
    tile.updatePosition(cell);
  }
  // Move tiles on the grid in the specified direction
  move(direction) {
    // 0: up, 1: right, 2:down, 3: left
    var self = this;
    if (this.over || this.won)
      return; // Don't do anything if the game's over
    var cell, tile;
    var vector = this.getVector(direction);
    var traversals = this.buildTraversals(vector);
    var moved = false;
    // Save the current tile positions and remove merger information
    this.prepareTiles();
    // Traverse the grid in the right direction and move tiles
    traversals.x.forEach(function (x) {
      traversals.y.forEach(function (y) {
        cell = {
          x: x,
          y: y
        };
        tile = self.grid.cellContent(cell);
        if (tile) {
          var positions = self.findFarthestPosition(cell, vector);
          var next = self.grid.cellContent(positions.next);
          // Only one merger per row traversal?
          if (next && next.value === tile.value && !next.mergedFrom) {
            var merged = new Tile(positions.next, tile.value * 2);
            merged.mergedFrom = [tile, next];
            self.grid.insertTile(merged);
            self.grid.removeTile(tile);
            // Converge the two tiles' positions
            tile.updatePosition(positions.next);
            // Update the score
            self.score += merged.value;
            // The mighty 2048 tile
            if (merged.value === 2048)
              self.won = true;
          } else {
            self.moveTile(tile, positions.farthest);
          }
          if (!self.positionsEqual(cell, tile)) {
            moved = true; // The tile moved from its original cell!
          }
        }
      });
    });
    if (moved) {
      this.addRandomTile();
      if (!this.movesAvailable()) {
        this.over = true; // Game over!
      }
    }
    return moved;
  }
  // Get the vector representing the chosen direction
  getVector(direction) {
    // Vectors representing tile movement
    var map = {
      0: {
        x: 0,
        y: -1
      },
      1: {
        x: 1,
        y: 0
      },
      2: {
        x: 0,
        y: 1
      },
      3: {
        x: -1,
        y: 0
      } // left
    };
    return map[direction];
  }
  // Build a list of positions to traverse in the right order
  buildTraversals(vector) {
    var traversals = {
      x: [],
      y: []
    };
    for (var pos = 0; pos < this.size; pos++) {
      traversals.x.push(pos);
      traversals.y.push(pos);
    }
    // Always traverse from the farthest cell in the chosen direction
    if (vector.x === 1)
      traversals.x = traversals.x.reverse();
    if (vector.y === 1)
      traversals.y = traversals.y.reverse();
    return traversals;
  }
  findFarthestPosition(cell, vector) {
    var previous;
    // Progress towards the vector direction until an obstacle is found
    do {
      previous = cell;
      cell = {
        x: previous.x + vector.x,
        y: previous.y + vector.y
      };
    } while (this.grid.withinBounds(cell) &&
      this.grid.cellAvailable(cell));
    return {
      farthest: previous,
      next: cell // Used to check if a merge is required
    };
  }
  movesAvailable() {
    return this.grid.cellsAvailable() || this.tileMatchesAvailable();
  }
  // Check for available matches between tiles (more expensive check)
  tileMatchesAvailable() {
    var self = this;
    var tile;
    for (var x = 0; x < this.size; x++) {
      for (var y = 0; y < this.size; y++) {
        tile = this.grid.cellContent({
          x: x,
          y: y
        });
        if (tile) {
          for (var direction = 0; direction < 4; direction++) {
            var vector = self.getVector(direction);
            var cell = {
              x: x + vector.x,
              y: y + vector.y
            };
            var other = self.grid.cellContent(cell);
            if (other) {}
            if (other && other.value === tile.value) {
              return true; // These two tiles can be merged
            }
          }
        }
      }
    }
    return false;
  }
  positionsEqual(first, second) {
    return first.x === second.x && first.y === second.y;
  }
}


class Grid {
  constructor(size) {
    this.size = size;
    this.cells = [];
    this.build();
  }
  // Build a grid of the specified size
  build() {
    for (var x = 0; x < this.size; x++) {
      var row = this.cells[x] = [];
      for (var y = 0; y < this.size; y++) {
        row.push(null);
      }
    }
  }
  // Find the first available random position
  randomAvailableCell() {
    var cells = this.availableCells();
    if (cells.length) {
      return cells[Math.floor(Math.random() * cells.length)];
    }
  }
  availableCells() {
    var cells = [];
    this.eachCell(function (x, y, tile) {
      if (!tile) {
        cells.push({
          x: x,
          y: y
        });
      }
    });
    return cells;
  }
  // Call callback for every cell
  eachCell(callback) {
    for (var x = 0; x < this.size; x++) {
      for (var y = 0; y < this.size; y++) {
        callback(x, y, this.cells[x][y]);
      }
    }
  }
  // Check if there are any cells available
  cellsAvailable() {
    return !!this.availableCells().length;
  }
  // Check if the specified cell is taken
  cellAvailable(cell) {
    return !this.cellOccupied(cell);
  }
  cellOccupied(cell) {
    return !!this.cellContent(cell);
  }
  cellContent(cell) {
    if (this.withinBounds(cell)) {
      return this.cells[cell.x][cell.y];
    } else {
      return null;
    }
  }
  // Inserts a tile at its position
  insertTile(tile) {
    this.cells[tile.x][tile.y] = tile;
  }
  removeTile(tile) {
    this.cells[tile.x][tile.y] = null;
  }
  withinBounds(position) {
    return position.x >= 0 && position.x < this.size &&
      position.y >= 0 && position.y < this.size;
  }
}


class VRActuator {
  constructor(board) {
    this.tileContainer = board;
    this.scoreContainer = document.getElementById("score-container");
    this.messageContainer = document.getElementById("game-message");
    this.score = 0;
  }
  actuate(grid, metadata) {
    var self = this;
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) {
          self.addTile(cell);
        }
      });
    });
    self.updateScore(metadata.score);
    if (metadata.over)
      self.message(false); // You lose
    if (metadata.won)
      self.message(true); // You win!
  }
  restart() {
    this.clearMessage();
  }
  clearContainer(container) {
    while (container.firstChild) {
      this.clearContainer(container.firstChild);
      container.removeChild(container.firstChild);
    }
  }
  setPosition(element, position) {
    element.setAttribute('position', {'x': position.x/10, 'y': 0, 'z': position.y/10});
  }
  addTile(tile) {
    var element = document.createElement('a-entity');
    var position = {x: tile.x, y: tile.y};
    element.setAttribute('mixin', 'tile');
    element.setAttribute('color', 'gold');
    this.setPosition(element, position);
    var text = document.createElement('a-text');
    text.setAttribute('value', tile.value);
    text.setAttribute('mixin', 'tileText');
    element.appendChild(text);
    this.tileContainer.appendChild(element);
  }
  updateScore(score) {
    this.clearContainer(this.scoreContainer);
    var difference = score - this.score;
    this.score = score;
    // this.scoreContainer.textContent = this.score;
    // if (difference > 0) {
    //   var addition = document.createElement("div");
    //   addition.classList.add("score-addition");
    //   addition.textContent = "+" + difference;
    //   this.scoreContainer.appendChild(addition);
    // }
  }
  message(won) {
    // var type = won ? "game-won" : "game-over";
    // var message = won ? "You win!" : "Game over!";
    // this.messageContainer.classList.add(type);
    // this.messageContainer.getElementsByTagName("p")[0].textContent = message;
  }
  clearMessage() {
    // this.messageContainer.classList.remove("game-won", "game-over");
  }
}


class Tile {
  constructor(position, value) {
    this.x = position.x;
    this.y = position.y;
    this.value = value || 2;
    this.previousPosition = null;
    this.mergedFrom = null; // Tracks tiles that merged together
  }
  savePosition() {
    this.previousPosition = {
      x: this.x,
      y: this.y
    };
  }
  updatePosition(position) {
    this.x = position.x;
    this.y = position.y;
  }
}
