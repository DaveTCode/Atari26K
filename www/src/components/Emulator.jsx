import React from 'react';
import PropTypes from 'prop-types';
import Grid from '@mui/material/Unstable_Grid2';
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
    <Grid container spacing={2}>
      <Grid xs={8}>
        <canvas id="backing-canvas" width="160" height="192" style={{ display: 'none' }} />
        <canvas id="emulator-screen" width="320" height="384" style={{ border: '1px solid #d3d3d3' }}>
          Your browser does not support the canvas tag
        </canvas>
      </Grid>
      <Grid xs={4}>
        Debugger
      </Grid>
    </Grid>
  );
}

Emulator.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  rom: PropTypes.array.isRequired,
};

export default Emulator;
