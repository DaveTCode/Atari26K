import React from 'react';
import Grid from '@mui/material/Unstable_Grid2';

function Emulator({ rom }) {
  return (
    <Grid container spacing={2}>
      <Grid xs={8}>
        <canvas id="emulatorScreen" width="320" height="384" style={{ border: '1px solid #d3d3d3' }}>
          Your browser does not support the canvas tag
        </canvas>
      </Grid>
      <Grid xs={4}>
        Debugger
      </Grid>
    </Grid>
  );
}

export default Emulator;
