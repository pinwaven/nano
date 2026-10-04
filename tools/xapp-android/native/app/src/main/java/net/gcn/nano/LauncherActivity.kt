package net.gcn.nano

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import io.dcloud.uniapp.sdk.UniAppXSDK

class LauncherActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        UniAppXSDK.start(null, this)
        finish()
    }
}
