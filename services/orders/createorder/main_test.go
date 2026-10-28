package main

import "testing"

func TestStubGeocodeIsStableAndInCentralLondon(t *testing.T) {
	lat, lng := stubGeocode("1 Main St, Springfield")
	again, againLng := stubGeocode("  1 main st, springfield ")
	if lat != again || lng != againLng {
		t.Errorf("same address geocoded to %v,%v and %v,%v", lat, lng, again, againLng)
	}
	if lat < 51.49 || lat > 51.515 || lng < -0.15 || lng > -0.10 {
		t.Errorf("%v,%v is outside central London", lat, lng)
	}
}

func TestGeocodeUsesTheStubWithoutAGeocoderURL(t *testing.T) {
	lat, lng, err := handler{}.geocode("1 Main St")
	wantLat, wantLng := stubGeocode("1 Main St")
	if err != nil || lat != wantLat || lng != wantLng {
		t.Errorf("got %v,%v,%v", lat, lng, err)
	}
}
