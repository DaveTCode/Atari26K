import React from 'react';
import PropTypes from 'prop-types';
import IconButton from '@mui/material/IconButton';
import PauseIcon from '@mui/icons-material/PauseCircle';
import PlayIcon from '@mui/icons-material/PlayCircle';
import RestartIcon from '@mui/icons-material/RestartAlt';
import Grid from '@mui/material/Unstable_Grid2';
import Background from './atari-bg.png';
import Atari2600 from '../emulator/atari2600';

function Emulator({ rom }) {
  const atari2600 = new Atari2600(rom);
  let canvasContext = null;
  let backingCanvasContext = null;
  let backingCanvas = null;

  const drawFrame = (frameBuffer) => {
    if (canvasContext === null) {
      const canvasElement = document.getElementById('emulator-screen');
      backingCanvas = document.getElementById('backing-canvas');
      canvasContext = canvasElement.getContext('2d');
      backingCanvasContext = backingCanvas.getContext('2d');
    }

    backingCanvasContext.putImageData(frameBuffer, 0, 0);
    canvasContext.drawImage(backingCanvas, 0, 0, 160, 192, 0, 0, 320, 384);
  };

  atari2600.run(drawFrame);

  return (
    <Grid
      container
      spacing={0}
      direction="column"
      alignItems="center"
      justifyContent="center"
      sx={{ minHeight: '100vh', height: '100vh' }}
    >
      <Grid item xs={4}>
        <div style={{ width: 756, height: 696, backgroundImage: `url(${Background})`, position: 'relative' }}>
          <canvas id="backing-canvas" width="160" height="192" style={{ display: 'none' }} />
          <canvas id="emulator-screen" width="320" height="384" style={{ position: 'absolute', left: '150px', top: '254px' }}>
            Your browser does not support the canvas tag
          </canvas>
          <IconButton aria-label="Pause" style={{ position: 'absolute', left: '618px', top: '585px' }} color="secondary">
            <PauseIcon onClick={atari2600.pause} />
          </IconButton>
          <IconButton aria-label="Play" style={{ position: 'absolute', left: '658px', top: '585px' }} color="secondary">
            <PlayIcon onClick={atari2600.play} />
          </IconButton>
          <IconButton aria-label="Restart" style={{ position: 'absolute', left: '714px', top: '585px' }} color="secondary">
            <RestartIcon onClick={atari2600.restart} />
          </IconButton>
        </div>
      </Grid>
    </Grid>
  );
}

Emulator.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  rom: PropTypes.array.isRequired,
};

export default Emulator;
