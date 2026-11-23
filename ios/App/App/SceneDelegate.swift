import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        let bridgeController = CAPBridgeViewController()
        window?.rootViewController = bridgeController
        window?.makeKeyAndVisible()
        // Capacitor web görünümünün esnemesini kapatıyor; sayfa kenara gelince sert durmasın diye
        // iOS'un doğal yumuşak esneme (bounce) davranışı açılır. Yalnız içerik kayıyorsa esner.
        bridgeController.loadViewIfNeeded()
        bridgeController.webView?.scrollView.bounces = true
        bridgeController.webView?.scrollView.alwaysBounceVertical = false

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
