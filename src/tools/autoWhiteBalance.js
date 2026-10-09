"use strict";

// The prior Camera Raw recording contained fixed $Temp=-32 and $Tint=-14
// alongside $WBal=auto. Replaying those fixed values would not establish an
// image-dependent automatic white balance, so this action is disabled.
// A future host probe must duplicate the selected photo, convert the duplicate
// to a Smart Object, apply Camera Raw as a Smart Filter, and verify that Auto
// recalculates per image before this function may modify a document.
async function autoWhiteBalance() {
  return {
    success: false,
    outcome: "unsupported",
    message: "Auto White Balance is unavailable until automatic Camera Raw behavior is verified in Photoshop."
  };
}

module.exports = { autoWhiteBalance };
