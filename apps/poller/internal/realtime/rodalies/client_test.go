package rodalies

import "testing"

func TestExtractLineCode(t *testing.T) {
	tests := []struct {
		label    string
		expected string
	}{
		// Standard Rodalies lines
		{"R4-77626-PLATF.(1)", "R4"},
		{"R1-12345-PLATF.(2)", "R1"},
		{"R2-54321-SOMETHING", "R2"},
		{"R7-98765", "R7"},
		{"R8-11111-TEST", "R8"},
		{"R11-22222", "R11"},
		{"R14-33333", "R14"},
		{"R15-44444", "R15"},
		{"R16-55555", "R16"},
		{"R17-66666", "R17"},

		// North/South variants
		{"R2N-77777-PLATF.(1)", "R2N"},
		{"R2S-88888-SOMETHING", "R2S"},

		// Regional lines
		{"RG1-99999", "RG1"},
		{"RL3-11111", "RL3"},
		{"RL4-22222", "RL4"},
		{"RT2-33333", "RT2"},

		// Lowercase should work too
		{"r4-77626-platf.(1)", "R4"},
		{"r2n-12345", "R2N"},

		// Edge cases
		{"", ""},
		{"UNKNOWN", ""},
		{"C1-12345", ""}, // Not a Rodalies line (Cercanías Madrid)
		{"S1-12345", ""}, // Not a Rodalies line
	}

	for _, tc := range tests {
		t.Run(tc.label, func(t *testing.T) {
			result := extractLineCode(tc.label)
			if result != tc.expected {
				t.Errorf("extractLineCode(%q) = %q, expected %q", tc.label, result, tc.expected)
			}
		})
	}
}
