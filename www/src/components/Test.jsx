import React, { useEffect, useState } from 'react';
import LoadingButton from '@mui/lab/LoadingButton'

const Test = ({ id }) => {
  const [testJson, setTestJson] = useState({});

  useEffect(() => {
    fetch(`https://raw.githubusercontent.com/TomHarte/ProcessorTests/main/6502/v1/${id.toString()}.json`)
       .then((res) => res.json())
       .then((data) => {
          setTestJson(data);
       })
       .catch((err) => {
          console.log(err.message);
       });
  }, []);

  if (testJson !== {}) {
    return (
      <h3>{testJson.name}</h3>
    )
  } else {
    return (
      <LoadingButton loading variant="outlined"></LoadingButton>
    )
  }
}

export default Test;