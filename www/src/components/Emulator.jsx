import React, { useEffect, useState } from 'react';

const Emulator = ({ rom }) => {
  return (
    <Grid container spacing={2}>
      <Grid xs={8}>
        <canvas id="emulatorScreen" width="320" height="384" style={{ border: "1px solid #d3d3d3" }}>
          Your browser doesn't support the canvas tag
        </canvas>
      </Grid>
      <Grid xs={4}>
        Debugger
      </Grid>
    </Grid>
  )
}

export default Test;