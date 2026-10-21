package classroom

import "encoding/json"

type jsonRaw = json.RawMessage

func jsonUnmarshal(data []byte, v any) error { return json.Unmarshal(data, v) }
