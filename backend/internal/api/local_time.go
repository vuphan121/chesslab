package api

import (
	"net/http"
	"time"

	_ "time/tzdata"
)

const timeZoneHeader = "X-Chesslab-Time-Zone"

type requestClock struct {
	date     string
	timeZone string
}

func localRequestClock(r *http.Request, now time.Time) requestClock {
	zone := r.Header.Get(timeZoneHeader)
	// "Local" is a Go stdlib special case, not a real IANA zone name — left
	// unhandled, time.LoadLocation("Local") happily resolves to whatever
	// zone this process happens to be running in, bypassing the UTC
	// fallback every other invalid/missing zone gets.
	if zone == "Local" {
		zone = ""
	}
	location, err := time.LoadLocation(zone)
	if err != nil || zone == "" {
		zone = "UTC"
		location = time.UTC
	}
	return requestClock{
		date:     now.In(location).Format(time.DateOnly),
		timeZone: zone,
	}
}

func currentRequestClock(r *http.Request) requestClock {
	return localRequestClock(r, time.Now())
}
