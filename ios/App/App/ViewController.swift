import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginType(AppleSignInPlugin.self)
    }
}
